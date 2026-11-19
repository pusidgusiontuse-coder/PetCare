from datetime import datetime, timezone
from pathlib import Path
import resource
import sys
import time

import psutil


def sample(read):
    try:
        return read()
    except (OSError, psutil.Error):
        return None


def cpu_times():
    times = psutil.cpu_times()._asdict()
    # Linux already includes guest time in user and nice time.
    total = sum(value for name, value in times.items() if name not in ('guest', 'guest_nice'))
    return {'total': total, 'idle': times['idle'] + times.get('iowait', 0)}


def worker_metrics():
    process = psutil.Process()
    with process.oneshot():
        return {
            'memory_bytes': sample(lambda: process.memory_info().rss),
            'threads': sample(process.num_threads),
            'uptime_seconds': sample(lambda: max(0, round(time.time() - process.create_time()))),
        }


def server_metrics():
    ram = sample(psutil.virtual_memory)
    swap = sample(psutil.swap_memory)
    disk = sample(lambda: psutil.disk_usage(str(Path(__file__).parent)))
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return {
        'captured_at': datetime.now(timezone.utc).isoformat(),
        'load_average': sample(psutil.getloadavg),
        'cpu_times': sample(cpu_times),
        'cpu_count': sample(psutil.cpu_count),
        'ram': {'total': ram.total, 'available': ram.available} if ram else None,
        'swap': {'total': swap.total, 'used': swap.used} if swap else None,
        'disk': {'total': disk.total, 'available': disk.free} if disk else None,
        'host_uptime_seconds': sample(lambda: max(0, round(time.time() - psutil.boot_time()))),
        'worker': sample(worker_metrics),
        'worker_peak_memory_bytes': peak if sys.platform == 'darwin' else peak * 1024,
    }
