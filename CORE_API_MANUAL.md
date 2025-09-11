# Agent Development Guide for Termux Extensions

## 1. High-Level Goal

Your primary goal is to develop a self-contained extension within the `app/extensions/` directory. You will consume the Core APIs provided by the main framework to build your features.

## 2. CRITICAL: Development Guardrails

**YOU MUST ADHERE TO THE FOLLOWING RULES. FAILURE TO DO SO WILL CORRUPT THE PROJECT.**

1.  **DO NOT MODIFY CORE FILES.** You are strictly forbidden from editing any file outside of your assigned extension's subdirectory. Core files include, but are not limited to:
    *   `/app/main.py`
    *   `/app/templates/index.html`
    *   Any file in `/scripts/`
    *   Any file in `/docs/`
    *   The project's `TODO.md` or `README.md`

2.  **WORK ONLY WITHIN YOUR EXTENSION DIRECTORY.** For the "Shortcut Wizard", your entire workspace is `/app/extensions/shortcut_wizard/`. All new files (`.py`, `.js`, `.html`) must be created here.

3.  **USE THE PROVIDED APIs.** Do not attempt to implement your own file browsing or shell execution logic. All interaction with the underlying system MUST go through the documented Core APIs listed below.

## 3. Core API Manual

The main application provides the following core API endpoints for use by all extensions.

---

### **File System**

#### `GET /api/browse`
Lists the contents of a directory.

*   **Query Parameters:**
    *   `path` (string, optional): The absolute path to browse. Defaults to the user's home directory (`~`).
*   **Success Response (200):**
    ```json
    [
      {
        "name": "directory_name",
        "type": "directory",
        "path": "/path/to/directory_name"
      },
      {
        "name": "file.txt",
        "type": "file",
        "path": "/path/to/file.txt"
      }
    ]
    ```
*   **Error Response (403/500):**
    ```json
    { "error": "Descriptive error message" }
    ```

--- 

### **Command Execution**

#### `POST /api/run_command`
Executes a generic shell command and returns its standard output. This is the primary method for extensions to get data from the system.

*   **Body (JSON):**
    ```json
    {
      "command": "your-command-here"
    }
    ```
*   **Success Response (200):**
    ```json
    {
      "stdout": "The output of the command..."
    }
    ```
*   **Error Response (500):**
    ```json
    {
      "error": "Command failed",
      "stderr": "The error output of the command..."
    }
    ```

---

### **System Information**

*(This section is deprecated. Use `/api/run_command` instead.)*

--- 

## 4. Instructions for `shortcut_wizard` Extension

### Task 1: UI Polish
- **Lowercase Inputs:** In `main.js`, for all relevant text input fields in the editor, add an event listener that forces the first word of any input to be lowercase. This is a quality-of-life improvement for mobile keyboards.
- **Simple Editor:** In `main.js`, modify the `renderEditList` function. When a user clicks on a shortcut where `is_editable` is `false`, do not open the wizard. Instead, show a new, simple modal containing a large `<textarea>`. Fetch the raw content of the script file and display it in the textarea for viewing or simple edits.

### Task 2: Wire up UI to APIs
- **File Browser:** The "Browse" button (`&#128193;`) next to an argument's value field should open the file browser modal. Use the `/api/browse` endpoint to populate it. When a file is selected, its path should populate the input field. When "Select Current Dir" is clicked, the current directory's path should be used.
- **$PATH Executable Picker:** The `$` button next to the main command input should call a new API endpoint (to be created by the framework agent) that lists all executables on the `$PATH`. This list should be displayed in a modal for the user to select from.

### Task 3: Multi-Command and Piping
- **"Add Command" Button:** In `main.js`, make this button functional. When clicked, it should append a new "Command Block" to the editor UI. A command block consists of a command input and its associated arguments section.
- **Visual Separator:** Between each command block, render a distinct visual separator (e.g., `<hr class="pipe-separator">`) that includes a small "remove" button (`&times;`) to delete that command block.
- **Backend Script Generation:** In `main.py`, update the `/create` endpoint. It must now be able to receive an array of command blocks. When generating the final `.sh` file, it should join each command block with a pipe (`|`).
