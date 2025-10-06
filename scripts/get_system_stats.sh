#!/data/data/com.termux/files/usr/bin/bash

set -eu

# --- CPU Usage ---
CPU_IDLE=$(top -n 1 | grep '%CPU' | awk '{print $8}' | cut -d'%' -f1)
CPU_USAGE=$(echo "100 - $CPU_IDLE" | bc)

# --- Memory Usage ---
MEM_STATS=$(free | grep 'Mem:')
MEM_TOTAL=$(echo $MEM_STATS | awk '{print $2}')
MEM_USED=$(echo $MEM_STATS | awk '{print $3}')
MEM_USAGE=$(echo "scale=2; ($MEM_USED / $MEM_TOTAL) * 100" | bc | cut -d'.' -f1)

printf '{"cpu_usage": %s, "mem_usage": %s}' "$CPU_USAGE" "$MEM_USAGE"