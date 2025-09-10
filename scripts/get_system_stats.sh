#!/data/data/com.termux/files/usr/bin/bash

set -eu

# --- CPU Usage ---
# Get the CPU idle percentage from the top command's output.
# The `top -n 1` command provides a single snapshot of the system state.
# We grep for the line containing "CPU", then use awk to find the idle percentage.
CPU_IDLE=$(top -n 1 | grep '%CPU' | awk '{print $8}' | cut -d'%' -f1)

# CPU usage is 100 - idle percentage. Use `bc` for floating point arithmetic.
CPU_USAGE=$(echo "100 - $CPU_IDLE" | bc)

# --- Memory Usage ---
# Get total and used memory from the `free` command.
# We grep for the "Mem:" line and use awk to extract the 2nd (total) and 3rd (used) columns.
MEM_STATS=$(free | grep 'Mem:')
MEM_TOTAL=$(echo $MEM_STATS | awk '{print $2}')
MEM_USED=$(echo $MEM_STATS | awk '{print $3}')

# Calculate memory usage percentage. Use `bc` with scale=2 for precision.
MEM_USAGE=$(echo "scale=2; ($MEM_USED / $MEM_TOTAL) * 100" | bc | cut -d'.' -f1)

# --- JSON Output ---
# Print the final data as a compact JSON object.
printf '{"cpu_usage": %s, "mem_usage": %s}' "$CPU_USAGE" "$MEM_USAGE"
