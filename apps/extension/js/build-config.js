/* Build-time distribution flags. scripts/package-extension.cjs replaces this file in the store ZIP. */
(function(root) {
  'use strict';
  // Unpacked development builds keep every feature. The packaged Chrome Web
  // Store build does not offer YouTube downloads (see docs/extension-release.md).
  root.SnagThisBuild = Object.freeze({ storeBuild: false });
})(typeof globalThis !== 'undefined' ? globalThis : this);
