const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const desktopDir = path.join(rootDir, "apps", "desktop");
const distDir = path.join(desktopDir, "dist");
const downloadsDir = path.join(rootDir, "public", "downloads");
const desktopPackage = require(path.join(desktopDir, "package.json"));

const version = desktopPackage.version;
const requiredFiles = [
  `NexoPOS_Setup_${version}.exe`,
  `NexoPOS_Setup_${version}.exe.blockmap`,
  "latest.yml"
];

fs.mkdirSync(downloadsDir, { recursive: true });

for (const file of requiredFiles) {
  const source = path.join(distDir, file);
  if (!fs.existsSync(source)) {
    throw new Error(`No existe ${source}. Primero ejecuta npm run desktop:dist.`);
  }

  fs.copyFileSync(source, path.join(downloadsDir, file));
}

const installerPath = path.join(downloadsDir, `NexoPOS_Setup_${version}.exe`);
const blockmapPath = path.join(downloadsDir, `NexoPOS_Setup_${version}.exe.blockmap`);
const manifest = {
  app: "Nexo POS",
  platform: "windows",
  channel: "stable",
  version,
  installer: `NexoPOS_Setup_${version}.exe`,
  blockmap: `NexoPOS_Setup_${version}.exe.blockmap`,
  latest: "latest.yml",
  installerBytes: fs.statSync(installerPath).size,
  blockmapBytes: fs.statSync(blockmapPath).size,
  preparedAt: new Date().toISOString()
};

fs.writeFileSync(
  path.join(downloadsDir, "release.json"),
  `${JSON.stringify(manifest, null, 2)}\n`
);

console.log(`Release desktop preparado en ${downloadsDir}`);
