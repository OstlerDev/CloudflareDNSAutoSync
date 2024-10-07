#!/bin/sh
docker build -t ostlerdev/cloudflare-dns-auto-sync:latest --platform=linux/amd64 .
docker tag ostlerdev/cloudflare-dns-auto-sync:latest ostlerdev/cloudflare-dns-auto-sync:$1
docker push ostlerdev/cloudflare-dns-auto-sync:latest
docker push ostlerdev/cloudflare-dns-auto-sync:$1