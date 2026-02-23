1. get ready to merge with main branch.
- clone on other devices with dependencies not installed and see what kind of issues we've run into. What kind of dependencies that we've missed.
- Make suresure everything looks the same as does on this device.
- Make debian apt dependency list and install script 
- Make a good install script... platform agnostic

2. convert run_framework.sh to mostly python
- make a loader python script that doesn't need run_framework.sh as a dependency (currently The entire framework requires a bash script as a dependency, blah.)

3. flesh out right click/teardrop tap.
- fix teardrop touch space (lower So the user can see the cursor while dragging the handle)
- re-add right click
- add features to touch menu 
- bundle in some editor quirk fixes
    A. 1st line deletion widget should appear ABOVE first line, not below it.
    B. saving blank documents (doesn't work)
    C. Creating empty document in explorer -> open empty document

4. think about issues mentions/dumps
- add mention to issue dialogs
- add cli insert/mention (dtach)

5. figure out hterm
- native mobile select (contenteditable swap?)

# 6. fix side bar <--- important 
- framework app launch
- fix lable (remove 'agent')
- fix drop down leaking off screen
- create worktree "app harness"

7. console mcp
- search
- mention

8. fix double hover on js
- remove monaco hovers

9. fix file name truncation
- on small screens
- make debug overlay a flaggable setting

x 10. reload theme change with correct monarch/ textmate semantic tokens color map 

result: done

11. disable zoom in android app.

12. figure out and publish a good set of system requirements (so far it looks like a gigabytes minimum system memory for Android 4G linux and fuck windows)

13. allow tap on deletion line in diff editor

x 14. fix settings.json relaunch workbench

result: done