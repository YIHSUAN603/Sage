// Cross-platform removal of macOS AppleDouble (._*) files that break the Tauri
// build on exFAT volumes. Replaces a Unix-only `find` invocation so the
// pre-build hook also works on the Windows CI runner.
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// .git included: a stray ._pack-*.idx in .git/objects/pack makes every git
// command spew "error: non-monotonic index".
const roots = ['src-tauri', 'src', '.git'];

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path);
    } else if (entry.name.startsWith('._')) {
      rmSync(path, { force: true });
    }
  }
}

roots.forEach(walk);
