# Cloudflare DNS Auto Sync

#### ✨🌐 Cloudflare DNS Auto Sync is a Node.js application that keeps your Cloudflare A records up-to-date with your current public IP address. Perfect for home setups with dynamic IP addresses, ensuring your domains always point to the right IP. 💖

## Features

* Automatically checks your public IP address and syncs it with your Cloudflare A records.
* Supports multiple domains and subdomains.
* Keeps things running smoothly without manual intervention.

## Getting Started
### Prerequisites

- Docker installed on your machine.
- A Cloudflare account with an API token that has the following permissions:
    - `Zone` - `Zone Settings` - `Read`
    - `Zone` - `Zone` - `Read`
    - `Zone` - `DNS` - `Edit`

## Installation

- **Docker:** Run the app using Docker: [`ostlerdev/cloudflare-dns-auto-sync:latest`](https://hub.docker.com/r/ostlerdev/cloudflare-dns-auto-sync)

### Environment Variables

To use this app, you'll need to set the following environment variables:

- `CLOUDFLARE_API_TOKEN`: Your Cloudflare API token.
- `MONITORED_DOMAINS`: A comma-separated list of domains or subdomains you want to monitor (e.g., `example.com,sub.example.com,*.domain.com`).
- `CHECK_INTERVAL`: The interval (in seconds) between checks for IP address changes. Default is `3600` (1 hour).

## Contributing

Feel free to submit issues or pull requests. Let's keep our domains synced and happy! 😊✨

