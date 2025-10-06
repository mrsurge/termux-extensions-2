#!/data/data/com.termux/files/usr/bin/bash

HELPER_SCRIPT="/data/data/com.termux/files/home/termux-extensions-2/app/helper_service.py"
PID_FILE="/data/data/com.termux/files/usr/var/run/te2_helper.pid"

start() {
    if [ -f "$PID_FILE" ]; then
        echo "Helper service is already running."
        return 1
    fi
    echo "Starting helper service..."
    # We assume this script itself is run with root privileges (e.g., by `su`)
    nohup python "$HELPER_SCRIPT" > /dev/null 2>&1 &
    echo $! > "$PID_FILE"
}

stop() {
    if [ ! -f "$PID_FILE" ]; then
        echo "Helper service is not running."
        return 1
    fi
    echo "Stopping helper service..."
    kill "$(cat "$PID_FILE")"
    rm -f "$PID_FILE"
}

case "$1" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    restart)
        stop
        start
        ;;
    *)
        echo "Usage: $0 {start|stop|restart}"
        exit 1
esac
