// Run by `lerna version` (root "version" lifecycle) after it bumps the
// packages. Lerna updates dependency ranges between workspace packages but
// not peerDependencies, and before 1.0 a caret range such as ^0.3.0 does not
// accept 0.4.0. Point every internal peer range at the new version.
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const pkgsDir = path.join(root, "packages");
const files = fs
  .readdirSync(pkgsDir)
  .map((dir) => path.join(pkgsDir, dir, "package.json"))
  .filter((file) => fs.existsSync(file));
const pkgs = files.map((file) => ({ file, json: JSON.parse(fs.readFileSync(file, "utf8")) }));
const versions = new Map(pkgs.map(({ json }) => [json.name, json.version]));

for (const { file, json } of pkgs) {
  // Private packages are not versioned or published (lerna.json "private": false).
  if (json.private) continue;
  let changed = false;
  for (const name of Object.keys(json.peerDependencies ?? {})) {
    const range = versions.has(name) && `^${versions.get(name)}`;
    if (range && json.peerDependencies[name] !== range) {
      json.peerDependencies[name] = range;
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
    execFileSync("git", ["add", file], { cwd: root });
    console.log(`${json.name}: peer ranges set to the new version`);
  }
}
