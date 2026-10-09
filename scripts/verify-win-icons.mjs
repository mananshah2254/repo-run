import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as PE from 'pe-library';
import * as ResEdit from 'resedit';

const files = process.argv.slice(2);
if (!files.length) {
  throw new Error('Pass one or more packaged Windows EXE paths to verify.');
}

const icon = ResEdit.Data.IconFile.from(await readFile('build/icon.ico'));
const digest = (data) => createHash('sha256').update(Buffer.from(data)).digest('hex');
const expected = icon.icons.map((item) => digest(item.data.bin)).sort();

for (const file of files) {
  const exe = PE.NtExecutable.from(await readFile(file), { ignoreCert: true });
  const resources = PE.NtExecutableResource.from(exe);
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);
  const actual = groups.flatMap((group) =>
    group.getIconItemsFromEntries(resources.entries).map((item) => digest(item.bin ?? item.generate())),
  ).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${file} does not contain all Repo Run icon sizes.`);
  }
  console.log(`Verified Repo Run icon in ${file} (${actual.length} sizes).`);
}
