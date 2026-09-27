#!/usr/bin/env bash
# Builds the Windows installer signed through Azure Artifact Signing.
# Needs AZURE_TENANT_ID, AZURE_CLIENT_ID and AZURE_CLIENT_SECRET for the snagthis-release-signing app.
# The publisher name must match the validated identity: Windows shows it, and the updater
# rejects updates whose signer differs, so it must stay the same in every release.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run dist --workspace @m3u8/desktop -- --win "$@" --publish=never \
  -c.forceCodeSigning=true \
  "-c.win.azureSignOptions.publisherName=Dylan Allred" \
  -c.win.azureSignOptions.endpoint=https://eus.codesigning.azure.net/ \
  -c.win.azureSignOptions.codeSigningAccountName=snagthisvid \
  -c.win.azureSignOptions.certificateProfileName=snagthis
