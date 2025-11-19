#!/usr/bin/env python

import os
import subprocess

def run_script(script_name, app_root_path, args=None):
    help
    help
    help
    """Helper function to run a shell script and return its output."""
    project_root = os.path.dirname(app_root_path)
    scripts_dir = os.path.join(project_root, 'scripts')
    if args is None: args = []
    script_path = os.path.join(scripts_dir, script_name)
    try:
        subprocess.run(['chmod', '+x', script_path], check=True)
        result = subprocess.run([script_path] + args, capture_output=True, text=True, check=True) #me forcing a in-line, word wrapped, deletion and insertion... how's my editor... pretty nice, huh?
        return result.stdout, None
    except Exception as e:
        return None, str(e)
