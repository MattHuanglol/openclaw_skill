#!/usr/bin/env python3
import subprocess
import sys
import shlex
import os

def main():
    # Construct the inner claude command
    # Assuming 'claude' is in PATH. 
    # We pass all arguments received by this script to claude.
    
    # Check if claude exists
    try:
        subprocess.run(["which", "claude"], check=True, stdout=subprocess.DEVNULL)
    except subprocess.CalledProcessError:
        print("Error: 'claude' executable not found in PATH.")
        sys.exit(1)

    # Build command string securely
    # Example: claude -p "hello" -> 'claude' '-p' 'hello'
    cmd_parts = ["claude"] + sys.argv[1:]
    inner_cmd = shlex.join(cmd_parts)
    
    # Wrap in script to force PTY
    # -q: Quiet
    # -c: Command
    # /dev/null: Output file (we don't need the file, we want stdout which script passes through)
    # wait, script writes to file AND stdout?
    # script -q -c "cmd" /dev/null
    # If using /dev/null as file, it works.
    
    # Note: 'script' behaves differently on BSD/Mac. Assuming Linux (util-linux).
    wrapper_cmd = ["script", "-q", "-c", inner_cmd, "/dev/null"]
    
    # Run it
    # We use subprocess.call to stream output to stdout/stderr in real-time
    try:
        ret = subprocess.call(wrapper_cmd)
        sys.exit(ret)
    except Exception as e:
        print(f"Wrapper Execution Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
