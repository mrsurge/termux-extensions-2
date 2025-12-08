import json
import psutil
import time
import sys

def main():
    while True:
        try:
            # Gather metrics
            # interval=None means non-blocking (since last call)
            # We sleep manually at the end
            cpu_total = psutil.cpu_percent(interval=None)
            cpu_cores = psutil.cpu_percent(interval=None, percpu=True)
            mem = psutil.virtual_memory()
            
            data = {
                'cpu_total': cpu_total,
                'cpu_cores': cpu_cores,
                'mem_percent': mem.percent,
                'mem_used': mem.used,
                'mem_total': mem.total
            }
            
            # Print JSON line and flush immediately
            print(json.dumps(data))
            sys.stdout.flush()
            
            time.sleep(1)
            
        except KeyboardInterrupt:
            break
        except Exception as e:
            # Send error as JSON so parent can log it
            print(json.dumps({'error': str(e)}))
            sys.stdout.flush()
            time.sleep(1)

if __name__ == "__main__":
    main()
