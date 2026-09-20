const desktopPackage = require('../apps/desktop/package.json');

const sourceRepository = new URL(desktopPackage.repository.url).pathname.replace(/^\//, '').replace(/\.git$/, '');

function verifyUpdateConfig(config, expectedRepository = sourceRepository) {
  if (config?.provider !== 'github' || `${config.owner}/${config.repo}`.toLowerCase() !== expectedRepository.toLowerCase()) {
    throw new Error(`Desktop update feed must use GitHub repository ${expectedRepository}`);
  }
  if (config.private !== false || config.token !== undefined || config.requestHeaders !== undefined ||
      (config.host !== undefined && config.host !== 'github.com') ||
      (config.protocol !== undefined && config.protocol !== 'https')) {
    throw new Error('Desktop update feed must be public HTTPS without embedded credentials');
  }
  return expectedRepository;
}

if (require.main === module) {
  try {
    const repository = verifyUpdateConfig(desktopPackage.build.publish[0], process.env.GITHUB_REPOSITORY || sourceRepository);
    console.log(`Desktop update repository: ${repository} (public access required at launch)`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { sourceRepository, verifyUpdateConfig };
