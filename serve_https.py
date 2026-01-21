import http.server
import ssl
import os
import sys

# Default port 443 needs sudo, otherwise use 8443
PORT = 443 
if len(sys.argv) > 1:
    PORT = int(sys.argv[1])

DIRECTORY = "web"

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

def run_server():
    server_address = ('0.0.0.0', PORT)
    httpd = http.server.HTTPServer(server_address, Handler)

    # Wrap with SSL
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certfile="cert.pem", keyfile="key.pem")
    httpd.socket = context.wrap_socket(httpd.socket, server_side=True)

    print(f"Serving HTTPS on https://0.0.0.0:{PORT}")
    print(f"Direct your browser to https://<YOUR_IP>")
    httpd.serve_forever()

if __name__ == "__main__":
    if not os.path.exists("cert.pem") or not os.path.exists("key.pem"):
        print("Error: cert.pem or key.pem not found. Run generate_certs.py first.")
        sys.exit(1)
        
    run_server()
