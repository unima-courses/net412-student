import os
from http.server import BaseHTTPRequestHandler, HTTPServer

class Handler(BaseHTTPRequestHandler):
    def reply(self, fragment=""):
        source = "host_a" if self.client_address[0] == "10.77.12.10" else "host_b or another host"
        response = (f"<html><body>NET412 legitimate service response for {source}"
                    f"<!-- response-fragment: {fragment} --></body></html>\n").encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def do_GET(self):
        self.reply()

    def do_POST(self):
        length = min(int(self.headers.get("Content-Length", "0")), 4096)
        content = self.rfile.read(length).decode(errors="replace")
        valid = self.client_address[0] == "10.77.12.10" and "<!-- request-fragment:" in content
        self.reply(os.environ.get("RESPONSE_PART", "fixture_response") if valid else "not-the-host-a-fragment")

HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
