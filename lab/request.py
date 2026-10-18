"""Generate a lab HTTP exchange; print visible page text, as a browser would."""
import os
import re
from urllib.request import Request, urlopen

body = ("<!-- request-fragment: " + os.environ.get("REQUEST_PART", "fixture_request") + " -->").encode()
request = Request("http://10.77.12.20:8080/", data=body, headers={"Content-Type": "text/html"})
with urlopen(request, timeout=8) as response:
    page = response.read().decode()
print(re.sub(r"<[^>]+>", "", re.sub(r"<!--.*?-->", "", page)))
