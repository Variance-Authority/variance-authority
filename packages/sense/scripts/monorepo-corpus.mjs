#!/usr/bin/env node
// Writes a generated JavaScript/TypeScript monorepo shaped like a large
// enterprise one, so the cost of `variance index --wait` can be measured on a
// checkout nobody has to share: workspace packages in dependency layers, each
// importing the packages of lower layers by name and exporting many names.
//
//   node packages/sense/scripts/monorepo-corpus.mjs <dir> [--packages 2000] [--layers 60]
//     [--files 10] [--exports 8] [--deps 6] [--back 0]
//
// Every dimension is a flag, so one can be scaled while the rest are held.
// `--back share` gives that share of packages one dependency on a package up
// to three layers above, which closes cycles among nearby layers; with none,
// the graph is acyclic.
// The output is deterministic and committed as one git commit, since the
// index lists files from git; node_modules holds the workspace links an
// install would make, so a package's name resolves to its directory.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    packages: { type: "string", default: "2000" },
    layers: { type: "string", default: "60" },
    files: { type: "string", default: "10" },
    exports: { type: "string", default: "8" },
    deps: { type: "string", default: "6" },
    back: { type: "string", default: "0" },
  },
});
const [root] = positionals;
if (root === undefined) {
  throw new Error("usage: monorepo-corpus.mjs <dir> [--packages n] [--layers n] [--files n] [--exports n] [--deps n] [--back share]");
}
const packages = Number(values.packages);
const layers = Math.min(Number(values.layers), packages);
const files = Number(values.files);
const exportsPer = Number(values.exports);
const depsPer = Number(values.deps);
const backShare = Number(values.back);

// A small linear congruential generator keeps the corpus the same on every run.
let seed = 1;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

const layerOf = (index) => Math.floor((index * layers) / packages);
const nameOf = (index) => `@corp/p${String(index).padStart(5, "0")}`;
const dirOf = (index) => join("packages", `l${String(layerOf(index)).padStart(3, "0")}`, `p${String(index).padStart(5, "0")}`);
const firstOfLayer = (layer) => Math.ceil((layer * packages) / layers);

// Nothing is deleted: a non-empty directory is refused, whoever wrote it.
if (existsSync(root) && readdirSync(root).length > 0) {
  throw new Error(`${root} is not empty; give the corpus an empty or new directory`);
}
mkdirSync(root, { recursive: true });
writeFileSync(
  join(root, "package.json"),
  `${JSON.stringify({ name: "corpus", private: true, workspaces: ["packages/*/*"] }, null, 2)}\n`,
);
writeFileSync(join(root, ".gitignore"), "node_modules\n");
mkdirSync(join(root, "node_modules", "@corp"), { recursive: true });
writeFileSync(join(root, "tsconfig.json"), `${JSON.stringify({ compilerOptions: { strict: true, module: "esnext" } }, null, 2)}\n`);

for (let index = 0; index < packages; index += 1) {
  const layer = layerOf(index);
  // Dependencies come from lower layers, most from the layer just below, so
  // the layering is deep rather than a fan from the bottom.
  const deps = new Set();
  if (layer > 0) {
    const below = firstOfLayer(layer);
    for (let tries = 0; deps.size < depsPer && tries < depsPer * 4; tries += 1) {
      const span = random() < 0.6 ? below - firstOfLayer(layer - 1) : below;
      const target = below - 1 - Math.floor(random() * span);
      if (target >= 0) deps.add(target);
    }
  }
  if (backShare > 0 && random() < backShare && layer + 1 < layers) {
    const above = firstOfLayer(layer + 1);
    const span = Math.min(firstOfLayer(Math.min(layer + 4, layers)), packages) - above;
    deps.add(above + Math.floor(random() * span));
  }
  const dependencies = [...deps].sort((a, b) => a - b);
  const dir = join(root, dirOf(index));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify(
      {
        name: nameOf(index),
        version: "1.0.0",
        main: "src/index.ts",
        dependencies: Object.fromEntries(dependencies.map((dep) => [nameOf(dep), "workspace:*"])),
      },
      null,
      2,
    )}\n`,
  );
  // A workspace install links every package under node_modules by name.
  symlinkSync(join("..", "..", dirOf(index)), join(root, "node_modules", "@corp", `p${String(index).padStart(5, "0")}`));
  const barrel = [];
  for (let file = 0; file < files; file += 1) {
    const lines = [];
    const used = dependencies.filter((_, position) => (position + file) % 2 === 0);
    for (const dep of used) {
      lines.push(`import { n${dep}_0_0 } from "${nameOf(dep)}";`);
    }
    if (file > 0) lines.push(`import { n${index}_${file - 1}_0 } from "./f${file - 1}";`);
    for (let name = 0; name < exportsPer; name += 1) {
      const terms = [String(name), ...used.map((dep) => `n${dep}_0_0`)];
      if (file > 0 && name === 0) terms.push(`n${index}_${file - 1}_0`);
      lines.push(`export const n${index}_${file}_${name}: number = ${terms.join(" + ")};`);
    }
    lines.push(`export function run${index}_${file}(value: number): number {\n  return value * ${file + 1};\n}`);
    writeFileSync(join(dir, "src", `f${file}.ts`), `${lines.join("\n")}\n`);
    barrel.push(`export * from "./f${file}";`);
  }
  writeFileSync(join(dir, "src", "index.ts"), `${barrel.join("\n")}\n`);
  writeFileSync(
    join(dir, "src", "index.test.ts"),
    `import { run${index}_0 } from "./index";\n\ntest("runs", () => {\n  expect(run${index}_0(1)).toBe(1);\n});\n`,
  );
}

const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
git("init", "-q", "-b", "main");
git("add", "-A");
git("-c", "user.name=corpus", "-c", "user.email=corpus@example.invalid", "commit", "-q", "-m", "corpus");
process.stdout.write(`${root}: ${packages} packages in ${layers} layers, ${packages * (files + 2)} source files\n`);
