(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VidSnagSelection = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SELECTION_FIELDS = Object.freeze(['variantUrl', 'height', 'audioLang', 'subtitleLang', 'audioOnly']);
  const SELECTION_SCHEMA = Object.freeze({
    type: 'object', additionalProperties: false,
    properties: Object.freeze({
      variantUrl: { type: 'string', format: 'uri', maxLength: 8192 },
      height: { type: 'integer', minimum: 1, maximum: 16384 },
      audioLang: { type: 'string', minLength: 1, maxLength: 64 },
      subtitleLang: { type: 'string', minLength: 1, maxLength: 64 },
      audioOnly: { type: 'boolean' },
    }),
  });
  function validateSelection(input) {
    if (input === undefined) return { ok: true, value: undefined, errors: [] };
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, value: undefined, errors: [{ field: 'selection', code: 'invalid_type', message: 'Selection must be an object' }] };
    const value = {};
    const errors = [];
    Object.keys(input).forEach(function (field) {
      const item = input[field];
      if (!SELECTION_FIELDS.includes(field)) { errors.push({ field: 'selection.' + field, code: 'unknown_field', message: 'Unknown selection field' }); return; }
      if (item === undefined) return;
      if (field === 'variantUrl') {
        let valid = typeof item === 'string' && item.length <= 8192;
        if (valid) {
          try {
            const url = new URL(item);
            valid = (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password;
            if (valid) value[field] = url.href;
          } catch { valid = false; }
        }
        if (!valid) errors.push({ field: 'selection.' + field, code: 'invalid_url', message: 'Variant URL must be an HTTP or HTTPS URL without embedded credentials' });
      } else if (field === 'height') {
        if (Number.isInteger(item) && item > 0 && item <= 16384) value[field] = item;
        else errors.push({ field: 'selection.' + field, code: 'invalid_height', message: 'Height must be a positive integer at most 16384' });
      } else if (field === 'audioOnly') {
        if (typeof item === 'boolean') value[field] = item;
        else errors.push({ field: 'selection.' + field, code: 'invalid_type', message: 'Audio only must be a boolean' });
      } else {
        if (typeof item === 'string' && item.trim().length > 0 && item.trim().length <= 64 && !/[\r\n\x00]/.test(item)) value[field] = item.trim();
        else errors.push({ field: 'selection.' + field, code: 'invalid_language', message: 'Language must be a nonempty string of at most 64 characters' });
      }
    });
    return { ok: errors.length === 0, value: errors.length ? undefined : value, errors: errors };
  }
  return { SELECTION_FIELDS: SELECTION_FIELDS, SELECTION_SCHEMA: SELECTION_SCHEMA, validateSelection: validateSelection };
});
