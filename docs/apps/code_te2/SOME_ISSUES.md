# Known Issues & TODO

## 1. Merge readiness
- [ ] Clone on other devices with dependencies not installed — identify missing deps
- [ ] Verify everything looks the same as on primary device
- [ ] Make Debian apt dependency list and install script
- [ ] Make a good install script — platform agnostic

## 2. Convert `run_framework.sh` to mostly Python
- [ ] Make a loader Python script that doesn't need `run_framework.sh` as a dependency
  (currently the entire framework requires a bash script as a dependency)

## 3. Touch menu & editor quirks
### Touch (done ✅)
- [x] Fix teardrop touch space — lower so user can see cursor while dragging handle
- [x] Re-add right click (touch context menu via teardrop tap)
- [x] Add features to touch menu (Select Word, Hover 🚁)
- [x] Drag debounce — defer interval to first touchmove so taps open the menu
- [x] Drag offset — 1.5 line-heights for finger clearance
- [x] Port all patches from minified to TypeScript source

### Editor quirks (open)
- [ ] A. 1st line deletion widget should appear ABOVE first line, not below it
- [ ] B. Saving blank documents (doesn't work)
- [ ] C. Creating empty document in explorer → open empty document

## 4. Issue mentions / dumps
- [ ] Add mention to issue dialogs
- [ ] Add CLI insert/mention (dtach)

## 5. Figure out hterm
- [ ] Native mobile select (contenteditable swap?)

## 6. Fix side bar ⚠️ important
- [ ] Framework app launch
- [ ] Fix label (remove 'agent')
- [ ] Fix dropdown leaking off screen
- [ ] Create worktree "app harness"

## 7. Console MCP
- [ ] Search
- [ ] Mention

## 8. Fix double hover on JS
- [ ] Remove Monaco hovers

## 9. Fix file name truncation
- [ ] On small screens
- [ ] Make debug overlay a flaggable setting

## ~~10. Reload theme change with correct Monarch / TextMate semantic tokens color map~~ ✅ done

## 11. Disable zoom in Android app
- [ ] Pending

## 12. System requirements
- [ ] Figure out and publish a good set of system requirements
  (so far: 4 GB minimum system memory for Android, Linux — and forget Windows)

## 13. Diff editor tap
- [ ] Allow tap on deletion line in diff editor

## ~~14. Fix settings.json relaunch workbench~~ ✅ done

## 15. User-friendly README for code_te2 app worker
- [ ] Create a concise, non-technical, user-friendly README for the code_te2 app worker