import { parseDomain, ParseResultType, Validation } from 'parse-domain';
import axios from 'axios';
import chalk from 'chalk';
import ora from 'ora';

console.log(chalk.magentaBright(`
============================
✨🌐 Cloudflare DNS Auto Sync 🌐✨
============================
`));
console.log(chalk.magenta(`🤖 Heyo! Let's make sure your domains are always up-to-date! ^u^ 💖`));

const DEBUG = process.env.DEBUG || false

const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
if (!CLOUDFLARE_API_TOKEN) {
  console.error(chalk.red('❌ Oh no! CLOUDFLARE_API_TOKEN is not set. Please provide a valid API token as an environment variable. 🔑'));
  process.exit(1);
}

// Get monitored domains from environment variable
const MONITORED_DOMAINS = process.env.MONITORED_DOMAINS;
if (!MONITORED_DOMAINS) {
  console.error(chalk.red('❌ Oh no! MONITORED_DOMAINS is not set. Please provide monitored domains as an environment variable. 🌍'));
  process.exit(1);
}

const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL, 10) || 21600; // Default to 6 hours if not set

function parseDomainParts(domain){
  const parseResult = parseDomain(domain);
  if (parseResult.type !== ParseResultType.Listed) {
    // Check if there was an issue with the wildcard at the start of the domain
    if(parseResult.errors[0]?.message == 'Label "*" contains invalid character "*" at column 1.') {
      // We are a wildcard, so let's relax the validation.
      return parseDomain(domain, { validation: Validation.Lax })
    }
  }
  return parseResult;
}

function formatInterval(interval) {
  const hours = Math.floor(interval / 3600);
  const minutes = Math.floor((interval % 3600) / 60);
  const seconds = interval % 60;
  
  let result = '';
  if (hours > 0) result += `${hours}h `;
  if (minutes > 0) result += `${minutes}m `;
  if (seconds > 0 || result === '') result += `${seconds}s`;
  return result.trim();
}

const monitoredDomains = MONITORED_DOMAINS.split(',')
  .map(domain => domain.trim())
  .filter(domain => {
    if (domain.length === 0) {
      console.warn(chalk.yellow('⚠️  Empty domain entry found, skipping. Please make sure all your domain entries are filled in. 💬'));
      return false;
    }
    const parseResult = parseDomainParts(domain);
    if (parseResult.type !== ParseResultType.Listed) {
      console.error(chalk.red(`❌ Oopsie! Invalid domain: ${chalk.yellow(domain)} 😵`));
      return false;
    }
    return true;
  });

for (const domain of monitoredDomains) {
  console.log(chalk.green(`✅ Yay! Monitoring domain: ${chalk.bold(chalk.yellow(domain))} 🎉`));
}

async function getPublicIP() {
  const publicIPServices = [
    'https://api.ipify.org?format=json',
    'https://ifconfig.me/all.json',
    'https://ipinfo.io/json'
  ];

  const spinner = ora('🔍 Fetching your public IP address...').start();

  for (const service of publicIPServices) {
    try {
      spinner.text = `🔍 Fetching public IP address from: ${service}`;
      const response = await axios.get(service);
      const ip = response.data.ip || response.data.address || response.data.query;
      if (ip) {
        spinner.succeed(`🌟 Public IP address fetched: ${chalk.cyan(ip)} 🎈`);
        return ip;
      }
    } catch (error) {
      spinner.warn(`⚠️  Failed to fetch IP address from ${service}, trying next service... 🚧`);
      if (DEBUG) { console.error(error) }
    }
  }

  spinner.fail('❌ Failed to fetch public IP address from all available services. 😢');
  throw new Error('Failed to fetch public IP address from all available services');
}

async function getCloudflareRecord(domain) {
  const spinner = ora(`🔍 Fetching Cloudflare record for domain: ${chalk.yellow(domain)}...`).start();
  const parseResult = parseDomainParts(domain);
  if (parseResult.type !== ParseResultType.Listed) {
    spinner.fail(`❌ Failed to parse domain: ${chalk.yellow(domain)} 😞`);
    throw new Error(`Failed to parse domain: ${chalk.yellow(domain)}`);
  }
  const rootDomain = `${parseResult.domain}.${parseResult.topLevelDomains.join('.')}`;

  try {
    spinner.text = `🔍 Fetching zone ID for root domain: ${rootDomain}`;
    const zoneResponse = await axios.get(`https://api.cloudflare.com/client/v4/zones?name=${rootDomain}`, {
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    if (zoneResponse.data.result.length === 0) {
      spinner.fail(`❌ Zone not found for domain: ${chalk.yellow(rootDomain)} 😢`);
      throw new Error(`Zone not found for domain: ${chalk.yellow(rootDomain)}`);
    }

    const zoneId = zoneResponse.data.result[0].id;
    spinner.succeed(`🌟 Zone ID for ${rootDomain} is ${chalk.cyan(zoneId)} ✨`);

    spinner.text = `🔍 Fetching DNS record for domain: ${chalk.yellow(domain)}`;
    const recordResponse = await axios.get(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?match=all`, {
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    if (recordResponse.data.result.length === 0) {
      spinner.fail(`❌ DNS record not found for domain: ${chalk.yellow(domain)} 😞`);
      throw new Error(`DNS record not found for domain: ${chalk.yellow(domain)}`);
    }

    // Optimize the logic to find matching DNS records for wildcards and special cases
    let record = recordResponse.data.result.find(r => r.name === domain && r.type == "A");

    if (record) {
      spinner.succeed(`🎉 Found A record for ${chalk.yellow(domain)}, record ID: ${chalk.cyan(record.id)} 🎈`);
      return { zoneId, record }; // Return the specific matched record
    }

    // If no exact match, attempt to find a wildcard record
    if (!record && domain.includes("*")) {
      record = recordResponse.data.result.find(r => r.name.startsWith('*.') && domain.endsWith(r.name.replace('*.', '')) && r.type == "A");
      if (record) {
        spinner.info(`🔮 Wildcard DNS Entry match found for ${chalk.yellow(domain)}, record ID: ${chalk.cyan(record.id)} ✨`);
      } else {
        // If still no match, assume user wants to update all records for this domain
        const aRecords = recordResponse.data.result.filter(r => r.type == "A");
        spinner.info(`💡 Wildcard does not exist as its own DNS entry for ${chalk.cyan(domain)}, treating this as a request to update all A records for the root domain. 📜`);
        return { zoneId, records: aRecords }; // Return all A records for bulk update
      }
    }

    spinner.fail(`❌ DNS record not found for domain: ${chalk.yellow(domain)} 😞`);
    throw new Error(`❌ DNS record not found for domain: ${chalk.yellow(domain)} 😞`)
  } catch (error) {
    if (error.response && error.response.status === 403) {
      spinner.fail(chalk.red('❌ Authentication error: Please check your Cloudflare API token. 🔑'));
    } else {
      spinner.fail(`❌ Error fetching Cloudflare record for domain ${chalk.yellow(domain)} 😵`);
    }
    if (DEBUG) { console.error(error) }
    throw error;
  }
}

async function getCloudflareIP(zoneId, record) {
  const spinner = ora(`🔍 Fetching current Cloudflare DNS IP for: ${chalk.yellow(record.name)}`).start();
  try {
    const response = await axios.get(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${record.id}`, {
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    spinner.succeed(`🌟 DNS IP for ${chalk.yellow(record.name)} is currently: ${chalk.cyan(response.data.result.content)} 🎉`);
    return response.data.result.content;
  } catch (error) {
    if (error.response && error.response.status === 403) {
      spinner.fail(chalk.red(`❌ Authentication error for ${chalk.yellow(record.name)}: Please check your Cloudflare API token. 🔑`));
    } else {
      spinner.fail(`❌ Error fetching Cloudflare DNS IP for ${chalk.yellow(record.name)} 😵`);
    }
    if (DEBUG) { console.error(error) }
    throw error;
  }
}

async function updateCloudflareRecord(zoneId, record, domain, newIP) {
  const spinner = ora(`🔄 Updating Cloudflare record for: ${chalk.yellow(record.name)}...`).start();
  try {
    // Preserve all settings except for the IP address
    await axios.put(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${record.id}`, {
      ...record,
      content: newIP
    }, {
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    spinner.succeed(`🎉 Successfully updated Cloudflare record for: ${chalk.yellow(record.name)} 💖`);
  } catch (error) {
    if (error.response && error.response.status === 403) {
      spinner.fail(chalk.red('❌ Authentication error: Please check your Cloudflare API token. 🔑'));
    } else {
      spinner.fail(`❌ Error updating Cloudflare record for ${chalk.yellow(record.name)} 😵`);
    }
    if (DEBUG) { console.error(error) }
    throw error;
  }
}

async function checkAndUpdateIP() {
  const spinner = ora('🚀 Starting IP check and update process...').start();
  try {
    const publicIP = await getPublicIP();
    spinner.succeed('🚀 Starting IP check and update process...');

    for (const domain of monitoredDomains) {
      try {
        console.log(chalk.blue(`
  🔄 Processing domain: ${chalk.bold(chalk.yellow(domain))} ✨`));
        const { zoneId, record, records } = await getCloudflareRecord(domain);

        if (record) {
          const cloudflareIP = await getCloudflareIP(zoneId, record);
          if (publicIP !== cloudflareIP) {
            console.log(chalk.bold(chalk.yellow(`🌈 DNS IP for ${chalk.yellow(record.name)} needs to be updated! Updating Cloudflare from ${cloudflareIP} to ${publicIP}... ✨`)));
            await updateCloudflareRecord(zoneId, record, domain, publicIP);
            console.log(chalk.green(`✔️  Cloudflare record for ${chalk.yellow(record.name)} updated successfully! 💚`));
          } else {
            console.log(chalk.cyan(`ℹ️  DNS IP for ${chalk.yellow(record.name)} is the same as ours! No update needed. 😊`));
          }
        } else if (records) {
          console.log(chalk.magenta(`🌟 (Wildcard) Checking if any DNS records for ${chalk.cyan(domain)} need to be updated to new IP: ${publicIP} ✨`));
          for (const r of records) {
            const cloudflareIP = await getCloudflareIP(zoneId, r);
            if (publicIP !== cloudflareIP) {
              console.log(chalk.bold(chalk.yellow(`🌈 DNS IP for ${chalk.yellow(r.name)} needs to be updated! Updating Cloudflare from ${cloudflareIP} to ${publicIP}... ✨`)));
              await updateCloudflareRecord(zoneId, r, domain, publicIP);
              console.log(chalk.green(`✔️  Cloudflare record for ${chalk.yellow(r.name)} updated successfully! 💚`));
            } else {
              console.log(chalk.cyan(`ℹ️  DNS IP for ${chalk.yellow(r.name)} is the same as ours! No update needed. 😊`));
            }
          }
          console.log(chalk.green(`✔️  (Wildcard) All DNS records for ${chalk.yellow(domain)} verified/updated! 💚`));
        }
      } catch (e) {
        spinner.fail(`❌ Error updating Cloudflare DNS for ${chalk.bold(chalk.yellow(domain))} 😵`);
        if (DEBUG) { console.error(error) }
      }
    }
    console.log(chalk.magentaBright(`
✨ All done! Great job! We'll keep things up-to-date for you. 💖✨`));
  } catch (error) {
    spinner.fail('❌ Error updating Cloudflare DNS 😵: ' + error);
    if (DEBUG) { console.error(error) }
  }

  const formattedInterval = formatInterval(CHECK_INTERVAL);
  console.log(chalk.magenta(`💤 Taking a nap for ${formattedInterval}... See you in a bit! 😴💤`));
  setTimeout(checkAndUpdateIP, CHECK_INTERVAL * 1000);
}

// Run the check
checkAndUpdateIP();