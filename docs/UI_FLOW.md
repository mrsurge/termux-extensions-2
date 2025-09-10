# Application UI Flow Map

This document outlines the visual and logical flow of the application, distinguishing between the core framework UI and the components loaded from extensions.

```
/ (index.html - Main View)
|
+-- [CORE FRAMEWORK]
|   |
|   +-- System Stats Grid (Static Placeholder)
|       |-- CPU Usage Card
|       +-- Memory Usage Card
|
+-- <div id="extensions-container"> (Dynamically Populated)
    |
    +-- << EXTENSION: Shortcut Wizard >>
    |   |
    |   +-- Main Menu View
    |   |   |-- [Button] "New Shortcut" --> (Triggers Editor View)
    |   |   +-- [Button] "Edit Shortcuts" --> (Triggers Edit List View)
    |   |
    |   +-- Editor View (hidden by default)
    |   |   |-- [Button] "<-- Back" --> (Triggers Main Menu View)
    |   |   |-- [Input] Filename
    |   |   |-- [Checkbox] Shebang
    |   |   |-- [Input] Command
    |   |   |-- [Textarea] Arguments
    |   |   +-- [Button] "Save Shortcut" --> (Calls API: /create)
    |   |
    |   +-- Edit List View (hidden by default)
    |       |-- [Button] "<-- Back" --> (Triggers Main Menu View)
    |       +-- (Dynamic list of .sh files...)
    |
    +-- << EXTENSION: Sessions & Shortcuts >>
        |
        +-- Session List Container
            |
            +-- (Dynamic list of sessions...)
                |
                +-- Session Card
                    |
                    +-- [Button] "..." (Menu)
                        |
                        +-- "Run Shortcut..." --> (Opens Shortcut Modal)
                        +-- "Run Command..." --> (Opens Command Modal)
                        +-- "Kill Session" --> (Calls API: /delete)

[MODALS] (Exist in main index.html but are triggered by extensions)
|
+-- Command Modal
+-- Shortcut Modal
```
