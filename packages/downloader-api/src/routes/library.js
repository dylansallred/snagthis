const { LibraryError } = require('../services/libraryFolders');
const logger = require('../utils/logger');

/** Saved's folders: the folder tree, and creating, renaming, deleting and moving into folders. */
function registerLibraryRoutes(app, historyIndex, folders) {
  const send = (res, task) => task.then((body) => res.json({ ok: true, ...body }), (error) => {
    if (error instanceof LibraryError) return res.status(error.status).json({ ok: false, code: error.code, error: error.message });
    logger.warn('Library folder request failed', { error: error && error.message });
    return res.status(500).json({ ok: false, code: 'unknown', error: 'The folder could not be changed' });
  });
  const text = (value) => (typeof value === 'string' ? value : null);

  app.get('/api/library', (req, res) => send(res, historyIndex.library()));
  app.post('/api/library/folders', (req, res) => send(res, folders.createFolder(text(req.body?.parent) ?? '', text(req.body?.name) ?? '')));
  app.post('/api/library/folders/rename', (req, res) => send(res, folders.renameFolder(text(req.body?.path) ?? '', text(req.body?.name) ?? '')));
  app.post('/api/library/folders/delete', (req, res) => send(res, folders.deleteFolder(text(req.body?.path) ?? '', text(req.body?.mode))));
  app.post('/api/library/move', (req, res) => send(res, folders.moveVideos(req.body?.ids, text(req.body?.to) ?? '').then((results) => ({ results }))));
}

module.exports = registerLibraryRoutes;
