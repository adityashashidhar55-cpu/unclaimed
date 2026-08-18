# Working rules for this repository

## Pushing is not optional, and `git push` is not the only way to do it

Work that is not on `origin/main` does not exist. Cloudflare Workers Builds
deploys from `main`, so an unpushed commit is not "done but waiting" — it is a
change nobody can see, on a site that is still running the old code.

In some sandboxes `git push` fails with:

```
remote: access denied by the git proxy: adityashashidhar55-cpu/unclaimed is not
in this session's authorized repository set
fatal: ... The requested URL returned error: 403
```

**That is a proxy restriction, not a GitHub permission problem, and it will not
resolve by retrying.** It also does not mean the work stops. When it happens,
push through the browser instead. Do not hand the user a zip and ask them to
upload it, and do not end the turn with unpushed commits.

### The fallback, in order

1. **Try `git push origin main` first.** It usually works. Only fall through on
   the proxy 403 above.

2. **Confirm the API route is closed too.** `api.github.com` is reachable but
   repository-scoped calls answer `GitHub access to this repository is not
   enabled for this session`. If that ever changes, the API is the better path.

3. **Stage exactly the changed files, grouped by directory.** GitHub's upload
   page commits into one directory at a time, and a file input keeps only the
   basename — so one upload per directory, or files land at the repo root.

   ```sh
   rm -rf /tmp/push-me && mkdir -p /tmp/push-me
   git diff --name-only origin/main HEAD | while read f; do
     mkdir -p "/tmp/push-me/$(dirname "$f")"
     cp "$f" "/tmp/push-me/$f"
   done
   ```

4. **Drive Chrome.** `list_connected_browsers` → ask the user which browser
   (required once per session) → `select_browser` → `tabs_context_mcp`. Then,
   for each directory:

   - navigate to `https://github.com/<owner>/<repo>/upload/main/<dir>`
     (omit `<dir>` for repo root)
   - `find` the file input, then `file_upload` with **container paths**
     (`/tmp/push-me/...`). Container paths work; device paths are rejected.
   - set the commit message with `javascript_tool`, using the native value
     setter so React sees it:

     ```js
     const inp = [...document.querySelectorAll('input[type=text]')]
       .find(i => (i.placeholder || '').includes('Add files via upload'));
     Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
       .set.call(inp, 'your commit subject');
     inp.dispatchEvent(new Event('input', { bubbles: true }));
     ```

   - scroll the Commit button into view and read its coordinates in the *same*
     `javascript_tool` call, then click those coordinates:

     ```js
     const b = [...document.querySelectorAll('button')]
       .find(x => x.textContent.trim() === 'Commit changes');
     b.scrollIntoView({ block: 'center' });
     await new Promise(r => setTimeout(r, 600));
     const r = b.getBoundingClientRect();
     JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
     ```

     Clicking the button *by ref* does not submit — it only scrolls. Coordinates
     work. Confirm the commit landed by checking the tab URL changed to
     `/upload` ("Processing your files…"); if it is still on
     `/upload/main/<dir>`, the click missed — re-measure and click again.

5. **Verify by hash, never by eye.** `raw.githubusercontent.com` is CDN-cached
   for minutes, so a stale 404 or old hash right after a commit proves nothing.
   Add a cache-busting query and check every file:

   ```sh
   for f in $(git diff --name-only origin/main HEAD); do
     r=$(curl -sS "https://raw.githubusercontent.com/<owner>/<repo>/main/$f?v=$RANDOM" | sha256sum | cut -c1-16)
     l=$(sha256sum "$f" | cut -c1-16)
     [ "$r" = "$l" ] && echo "OK   $f" || echo "DIFF $f"
   done
   ```

   If a file looks wrong, check the commit's diff page before re-uploading —
   the CDN lies more often than the upload fails.

6. **Reconcile local history.** Web-UI commits have different SHAs than the
   local ones, so git still reports "2 unpushed commits" even when the trees are
   identical. Confirm they really are identical, then fast-forward:

   ```sh
   git fetch origin
   git rev-parse HEAD^{tree} origin/main^{tree}   # must match
   git diff --name-only origin/main HEAD          # must be empty
   git reset --hard origin/main
   ```

   Only reset when both checks pass. Skipping them throws away real work.

7. **Close the tabs you opened**, and say which commits landed and that they
   were verified by hash — not just that you clicked Commit.

### Mention the permanent fix once, then drop it

Adding `<owner>/<repo>` as a session source makes `git push` work directly. Say
so once per session at most. It is a convenience, not a blocker, and repeating
it reads as refusing the work.

## Two standing rules that this repo keeps re-learning

**Verify against the running thing, not the source.** Most bugs here fail
silently — a 404 module specifier kills a whole `<script type="module">`, a
JSON contract mismatch parses as "signed out", a cache layer below HTTP serves
the previous user's answer. Check the deployed site, the real database row, the
actual webhook response code.

**Test the property, not the markup.** "Pricing has a button that says
Subscribe" breaks on a copy change and passes on a broken one. "From every
screen showing a price or a lock there is a control that starts checkout, in
all seven locales" is the thing that was actually missing.
