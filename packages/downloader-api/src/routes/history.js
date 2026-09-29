const path = require('path');
const fs = require('fs');
const { isMediaFilePath } = require('@m3u8/downloader-engine/src/utils/mediaFiles');

const MEDIA_TYPES = {
  '.mp4': 'video/mp4', '.ts': 'video/mp2t', '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime', '.webm': 'video/webm', '.m4v': 'video/x-m4v', '.avi': 'video/x-msvideo',
};

function registerHistoryRoutes(app, historyIndex, fsPromises, downloadDir, options = {}) {
  if (!historyIndex) throw new Error('registerHistoryRoutes requires historyIndex');
  const find = (req) => historyIndex.findById(req.params.fileName);
  const remove = async (item) => {
    await historyIndex.removeById(item.id);
    if (typeof options.onRemoveItem === 'function') await options.onRemoveItem(item);
  };
  const trash = async (item) => {
    const filePath = historyIndex.resolveFilePath(item.id);
    if (filePath && fs.existsSync(filePath)) {
      if (typeof options.onTrashFile !== 'function') {
        const error = new Error('Move to Trash is available in the desktop app');
        error.statusCode = 501;
        throw error;
      }
      await options.onTrashFile(filePath);
    }
    await remove(item);
  };

  app.get('/api/history', async (req, res) => {
    try {
      const result = await historyIndex.list({ limit: req.query.limit, cursor: req.query.cursor, q: req.query.q || req.query.search, folder: typeof req.query.folder === 'string' ? req.query.folder : undefined, sort: req.query.sort });
      res.json({ items: result.items, nextCursor: result.nextCursor, total: result.total });
    } catch { res.status(500).json({ error: 'The saved list could not be loaded' }); }
  });

  app.delete('/api/history', async (req, res) => {
    if (req.query.confirm !== 'delete-files') return res.status(400).json({ error: 'Choose individual videos to remove; bulk trash requires confirm=delete-files' });
    if (typeof options.onTrashFile !== 'function') return res.status(501).json({ error: 'Move to Trash is available in the desktop app' });
    let removed = 0;
    try {
      for (const item of [...historyIndex.items]) {
        await trash(item);
        removed += 1;
      }
      return res.json({ ok: true, removed });
    } catch (error) { return res.status(error.statusCode || 500).json({ error: 'Some files could not be moved to Trash', removed }); }
  });

  for (const action of ['file', 'stream']) {
    app.get(`/api/history/${action}/:fileName`, (req, res) => {
      const item = find(req);
      const filePath = item && historyIndex.resolveFilePath(item.id);
      if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'File moved or deleted', code: 'FILE_MISSING' });
      const contentType = MEDIA_TYPES[path.extname(filePath).toLowerCase()];
      if (!contentType) return res.sendStatus(404);
      if (action === 'file') return res.download(filePath, item.title ? `${item.title}${path.extname(filePath)}` : item.fileName);
      res.setHeader('Content-Type', contentType);
      return res.sendFile(filePath);
    });
  }

  app.post('/api/history/:fileName/open', async (req, res) => {
    const item = find(req);
    const filePath = item && historyIndex.resolveFilePath(item.id);
    if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'File moved or deleted', code: 'FILE_MISSING' });
    if (!isMediaFilePath(filePath)) return res.status(415).json({ error: 'Only video and audio files can be opened' });
    if (typeof options.onOpenFile !== 'function') return res.status(501).json({ error: 'Open the file from the desktop app' });
    try {
      const error = await options.onOpenFile(filePath);
      if (typeof error === 'string' && error) throw new Error(error);
      return res.json({ ok: true });
    } catch { return res.status(500).json({ error: 'The file could not be opened' }); }
  });

  app.post('/api/history/:fileName/locate', async (req, res) => {
    const item = find(req);
    if (!item) return res.status(404).json({ error: 'Saved item not found' });
    if (typeof options.onLocateFile !== 'function') return res.status(501).json({ error: 'Locate the file from the desktop app' });
    try {
      const selected = await options.onLocateFile(item);
      if (!selected) return res.json({ ok: false, cancelled: true });
      if (!MEDIA_TYPES[path.extname(selected).toLowerCase()] || !(await fsPromises.stat(selected)).isFile()) return res.status(400).json({ error: 'Choose a video file' });
      const updated = await historyIndex.locateById(item.id, selected);
      return res.json({ ok: true, item: updated });
    } catch { return res.status(500).json({ error: 'The file could not be located' }); }
  });

  app.delete('/api/history/:fileName', async (req, res) => {
    const mode = req.query.mode || 'list';
    if (!['list', 'trash'].includes(mode)) return res.status(400).json({ error: 'mode must be list or trash' });
    const item = find(req);
    if (!item) return res.status(404).json({ error: 'Saved item not found' });
    try {
      if (mode === 'trash') await trash(item);
      else await remove(item);
      return res.json({ ok: true, mode });
    } catch (error) { return res.status(error.statusCode || 500).json({ error: 'The file could not be moved to Trash; it remains in your list' }); }
  });
}

module.exports = registerHistoryRoutes;
