# termux-extensions-2

**`termux-extensions-2`** is a web framework for Termux that provides a mobile-friendly UI to manage and interact with the Termux environment. It operates as a local Flask-powered web server, presenting a clean UI for controlling your terminal sessions.

The core functionality is delivered through a system of "extensions" that leverage standard command-line tools to provide rich, interactive control over your Termux sessions.

## Project Philosophy

While this framework can assist users unfamiliar with shell scripting, its primary audience is **power users**. The core goal is to transcend the inherent limitations of using touchscreen keyboards with a traditional command-line interface. Even with excellent terminal emulators like Termux, typing complex commands and managing multiple sessions on a touch device has reached a plateau of efficiency.

This project aims to break through that plateau by creating a fluid, intuitive, and **touch-friendly interface** for navigating and controlling the Termux multitasking environment. It draws inspiration from the philosophy of frameworks like *Oh My Zsh* and *Oh My Fish*—which enhance the shell experience with smart helpers and plugins—and adapts that spirit to a graphical, touch-centric paradigm.

## How to Run

1.  **Install Dependencies:**
    ```bash
    pip install -r requirements.txt
    ```

2.  **Hook a Shell:** For each terminal session you want to monitor, you must source the `init.sh` script. This can be done manually for each session or by adding it to your `~/.bashrc` file.
    ```bash
    # Manually source for the current session
    source scripts/init.sh
    ```

3.  **Run the Server:** In a separate shell that you **do not** want to monitor, run the Flask application. Set the `TE_SESSION_TYPE` variable to `framework` to hide this shell from the UI.
    ```bash
    TE_SESSION_TYPE="framework" python app/main.py
    ```

4.  **Access the UI:** Open a web browser and navigate to `http://localhost:8080`.

## Key Features

*   **Web-Based UI:** A clean, modern interface accessible from a web browser.
*   **Session Management:** The "Sessions & Shortcuts" extension allows for powerful control over active Termux terminals, including running commands and killing sessions.
*   **Easy Installation:** Designed to be installed as a standard Debian package via `apt`.
