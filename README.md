# tesla-powerwall-automation

- [tesla-powerwall-automation](#tesla-powerwall-automation)
  - [Overview](#overview)
  - [Quick Setup](#quick-setup)
    - [Prerequisites](#prerequisites)
    - [First-time API setup](#first-time-api-setup)
    - [Running the app](#running-the-app)
    - [HTTPS / Self-Signed Certificate](#https--self-signed-certificate)
    - [PostgreSQL TLS](#postgresql-tls)
    - [Environment variables](#environment-variables)
    - [Sessions](#sessions)
  - [Tesla Fleet API onboarding](#tesla-fleet-api-onboarding)
    - [Preparation](#preparation)
      - [Project Site](#project-site)
      - [User Site](#user-site)
    - [Application Registration](#application-registration)
    - [Region registration](#region-registration)
      - [Retrieve client credentials](#retrieve-client-credentials)
      - [Register the region](#register-the-region)
  - [Tesla Fleet API authentication](#tesla-fleet-api-authentication)

## Overview

Tesla Powerwall Automation is a full-stack web application for automating your Tesla Powerwall through a flexible schedule system. Rather than relying on the fixed routines in the Tesla app, it lets you define exactly when and under what conditions your Powerwall should change behavior — and then executes those changes automatically via the Tesla Fleet API.

You create schedules that combine a cron expression, a set of conditions, and one or more actions. Conditions cover battery state (charged up to X%, discharged down to X%, discharged to backup reserve), real-time energy flow (home usage, solar generation, grid import and export in kW), and an optional time window. When a condition transitions from unmet to met, the corresponding action fires once — setting the backup reserve percentage, switching the operational mode, toggling grid charging, or controlling energy exports. The action is then suppressed until the condition clears and re-triggers, so the API is never hammered unnecessarily.

Alongside scheduling, the application provides a real-time dashboard showing battery state of charge, solar generation, home consumption, and grid import/export for every registered site. All scheduling configuration is done through a purpose-built UI — no config files or manual API calls required during day-to-day use.

Built with Bun, Express, TypeORM + PostgreSQL on the backend; React 19, Vite, and Material-UI on the frontend. Docker Compose provides the database. Schedules run via `node-cron`; Pino handles structured logging throughout.

> **Tesla API cadence note:** The `live_status` endpoint (battery SOC, real-time power flows) appears to refresh approximately every 5 minutes on Tesla's side, regardless of how often the application polls it. Consecutive schedule evaluations within that window will therefore see the same SOC reading — this is expected and does not indicate a bug. The solar history endpoint (`calendar_history`) is cached locally for 10 minutes and refreshed in full on each cache miss, including a fresh fetch of today's partial data to keep the weather scaling factor current.

## Quick Setup

### Prerequisites

- [Bun](https://bun.sh/) — runtime and package manager
- Docker and Docker Compose — for the PostgreSQL database
- A Tesla developer account with a registered Fleet API application (see [Tesla Fleet API onboarding](#tesla-fleet-api-onboarding) below for the one-time registration steps)

### First-time API setup

Before running the application for the first time, complete the [Tesla Fleet API onboarding](#tesla-fleet-api-onboarding) section to register your application with Tesla and obtain your `TESLA_CLIENT_ID`, `TESLA_CLIENT_SECRET`, and a user refresh token. This is a one-time process per developer account.

### Running the app

1. Clone the repository and install dependencies:

   ```sh
   bun install
   ```

2. Copy the sample environment file and fill in your credentials:

   ```sh
   cp env/sample.env .env
   ```

3. Start the PostgreSQL database:

   ```sh
   bun run docker:up
   ```

4. Obtain a Tesla refresh token (interactive OAuth flow — one time per user account):

   ```sh
   bun run new-refresh-token
   ```

5. Start the development server:

   ```sh
   bun run dev
   ```

6. Open the UI at `http://localhost:5173`.

> **Tip:** Set `DRY_RUN=true` in `.env` during initial testing. The scheduler will log every intended API call without actually sending it to Tesla, so you can verify your schedules and conditions behave as expected before going live.

### HTTPS / Self-Signed Certificate

Running the server over HTTPS enables the session cookie's `secure` flag, which prevents it from being sent over plain HTTP. For production or self-hosted deployments this is strongly recommended.

The server reads three environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `SSL_ENABLED` | `false` | Set to `true` to start the server with HTTPS |
| `SSL_KEY_PATH` | `ssl/key.pem` | Path to the TLS private key, relative to the project root |
| `SSL_CERT_PATH` | `ssl/cert.pem` | Path to the TLS certificate, relative to the project root |

#### Generate a self-signed certificate

For local testing or private self-hosting, a self-signed certificate is sufficient. Run the following once from the project root:

```sh
mkdir -p ssl
openssl req -x509 -newkey rsa:4096 -keyout ssl/key.pem -out ssl/cert.pem \
  -days 365 -nodes \
  -subj "/CN=localhost" \
  -addext "subjectAltName=IP:127.0.0.1,DNS:localhost"
```

> **Note:** The `ssl/` directory is gitignored. Never commit private keys to source control.

#### Enable HTTPS in `.env`

```dotenv
SSL_ENABLED=true
SSL_KEY_PATH=ssl/key.pem
SSL_CERT_PATH=ssl/cert.pem
```

#### Trust the certificate in your browser

Because the certificate is self-signed, browsers will show a security warning on first visit. One-time steps to suppress it:

- **Chrome / Edge:** Navigate to `https://localhost:3001`, click **Advanced**, then **Proceed to localhost**.
- **Firefox:** Navigate to `https://localhost:3001`, click **Advanced**, then **Accept the Risk and Continue**.
- **macOS system trust (optional):** Import `ssl/cert.pem` into Keychain Access (System keychain) and mark it as **Always Trust** to remove the warning across all browsers.

  ```sh
  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ssl/cert.pem
  ```

#### Certificate renewal

Self-signed certificates generated with the command above are valid for 365 days. Re-run the `openssl` command to renew and restart the server.

> **Important:** Replacing the certificate does **not** affect session cookies or stored tokens — only the TLS handshake changes.

---

### PostgreSQL TLS

Encrypts the connection between the application and PostgreSQL so that credentials and query results are not sent over plaintext TCP. Recommended for any deployment where the app and database are not on the same machine.

#### What happens to existing data?

**Nothing — your data is safe.** `bun run docker:down` stops and removes the database *container*, but not its *data*. The database lives in a Docker named volume (`db`) that persists independently of containers. Only `docker-compose down -v` (explicitly passing `-v`) removes the volume. A `docker:down` followed by `docker:up` restarts Postgres against the same on-disk data, with or without TLS changes.

#### Step 1 — Generate certificates (one time)

Run this once from the project root:

```sh
bun run generate-certs
```

This creates four files in `postgres/certs/`, all gitignored:

| File | Purpose |
| --- | --- |
| `ca.key` | CA private key — keep safe, not needed at runtime |
| `ca.crt` | CA certificate — trusted by the application to verify Postgres |
| `server.key` | Postgres server private key |
| `server.crt` | Postgres server certificate, signed by the CA |

#### Step 2 — Enable TLS in `.env`

```dotenv
DB_SSL=true
DB_SSL_CA_PATH=./postgres/certs/ca.crt
```

#### Step 3 — Restart the database

```sh
bun run docker:down
bun run docker:up
```

Postgres now starts with `ssl=on`. The application verifies the server certificate against the CA — connections are both encrypted and authenticated. `rejectUnauthorized: true` is enforced, so a misconfigured or mismatched certificate causes the app to fail at startup rather than silently fall back to an unencrypted connection.

#### Deploying to QNAP Container Station

The steps are identical. Copy the `postgres/certs/` directory alongside `docker-compose.yml` on the NAS, set `DB_SSL=true` and `DB_SSL_CA_PATH=./postgres/certs/ca.crt` in the environment, and restart the containers. Data in the named volume is unaffected.

#### Renewing database certificates

Certificates generated by this script are valid for 10 years. To renew, re-run `bun run generate-certs` and restart with `bun run docker:down && bun run docker:up`.

---

### Environment variables

The full list of variables is in `env/sample.env`. The essentials:

| Variable | Required | Description |
| --- | --- | --- |
| `TESLA_CLIENT_ID` | ✅ | OAuth 2.0 Client ID from developer.tesla.com |
| `TESLA_CLIENT_SECRET` | ✅ | OAuth 2.0 Client Secret |
| `TESLA_API_BASE_URL` | ✅ | Regional Fleet API endpoint (e.g. `https://fleet-api.prd.na.vn.cloud.tesla.com` for North America) |
| `DB_HOST` | ✅ | PostgreSQL host |
| `DB_USERNAME` | ✅ | PostgreSQL username |
| `DB_PASSWORD` | ✅ | PostgreSQL password |
| `DB_NAME` | ✅ | PostgreSQL database name |
| `SCHEDULED_JOBS_DISABLED` | — | Set to `true` to disable all cron jobs (default: `false`) |
| `DRY_RUN` | — | Set to `true` to log intended API calls without executing them |
| `SESSION_SECRET` | — | HTTP session secret (defaults to a built-in value if unset) |
| `ALLOWED_ORIGINS` | — | Comma-separated browser origins the API will accept cross-origin requests from. Default: `http://localhost:5173,https://localhost:5173`. See note below. |

> **`ALLOWED_ORIGINS` and Docker**
>
> In a production Docker build the frontend is compiled and served as static files by the same Express process. The browser loads the page and calls the API from the same host and port, so all requests are same-origin — CORS does not apply and `ALLOWED_ORIGINS` has no effect.
>
> `ALLOWED_ORIGINS` is only relevant when the Vite dev server is running separately from the API (the default local development setup: `bun run dev` starts Vite on port 5173 while the API runs on port 3001). The default value covers this case.
>
> If you run the backend in Docker locally while keeping Vite outside the container, set `ALLOWED_ORIGINS` to the Vite server's URL (e.g. `http://localhost:5173`).

### Sessions

The app uses server-side sessions backed by Redis with a maximum lifetime of 4 hours. Independently of that, the browser client tracks user activity (mouse movement, clicks, keyboard, scroll) and automatically logs out after **1 hour of inactivity**, redirecting to the login page. The client also polls the session endpoint every 2 minutes so that an invalidated session (e.g. after a server restart or Redis flush) is detected promptly even on pages that make no other API calls.

## Tesla Fleet API onboarding

Tesla Fleet API is pay as you go, but you are getting a monthly $10 credit. Unless you are doing some high frequency interaction with your Powerwall(s), this should give you plenty of rate to interact with your Powerwall(s) for free.

### Preparation

#### Project Site

You will need to have a public website for the registration process for the Tesla Fleet API. Because each Application you register requires its own registration, I will create all resources in my project repository.

I used Pages in GitHub for this:

In my repo, I created a folder `/doc` with an `index.html` that explains the purpose of my project. I wanted to make sure it contains sufficient information, so I included a logo, favicon, light/dark mode support, a diagram and detailed explanation. Since, I didn't know exactly what to expect from the Tesla Fleet API in terms of capabilities; so, I remained rather vague on technical details and focussed on the ideas rather.

To bring the website live, In GitHub, you have to navigate to `Settings` → `Pages` for this repository:

- Under `Build and deployment` → `Source`, make sure that `Deploy from a branch` is selected.
- Under `Build and deployment` → `Branch`, pick the branch and path. I chose `main` and `/doc`, which gives me the opportunity to create and merge pull requests as usual (as opposed to building the website from a branch).
- I opted out of using a `Custom domain`, as it is not necessary.
- Make sure that `Enforce HTTPS` is selected (I don't think it can be modified)

Once this is all set, wait a few minutes and then navigate to the website as indicated on the top of the `Settings` → `Pages` in GitHub (refresh to see it).
My project site can be accessed here: [https://katjes733.github.io/tesla-powerwall-automation/](https://katjes733.github.io/tesla-powerwall-automation/).

When satisfied with the page and its content, you can move to the next step.

#### User Site

Tesla Fleet API will require a public key to be publicly accessible with a fixed path under a top-level domain.
In my case, the location would need to look like this with a domain of `katjes733.github.io`: `https://katjes733.github.io/.well-known/appspecific/com.tesla.3p.public-key.pem`
This file is necessary to register your application to an API endpoint region and thus ensure that the API Endpoint can accept requests.

For this, I opted to use a User site in GitHub. The reason for this is that I didn't want to deal with hosting a full website and incurring additional cost. Generally you can also register a domain and host a custom website (e.g. using Amazon S3, etc.).

I basically followed a similar approach as for the Project Site with some significant differences:

- I needed to create a new repository with a name of `katjes733.github.io` (requirement for hosting a user site directly at `https://katjes733.github.io`).
- Then, I created an `index.html` in the repository root and added a bit about myself. I will add direct references to my favorite repositories at some later point, but for now, this suffices.
- To create the public key file, I did the following

  1. Create a repository folder at `./.well-known/appspecific/`
  2. Navigate to that folder in the console and execute the following:

  ```sh
  openssl ecparam -name prime256v1 -genkey -noout -out ec_private_key.pem
  openssl ec -in ec_private_key.pem -pubout -out com.tesla.3p.public-key.pem
  ```

  4. I then moved the `ec_private_key.pem` to a save location, as I don't want private keys to be part of the repository for obvious reasons.
  5. Add the remaining file `com.tesla.3p.public-key.pem` to the repository.

- To make the file `com.tesla.3p.public-key.pem` downloadable, it was also necessary to create an empty file `.nojekyll` in the repository root. Without, the file is not packaged and deployed. Since, my user site is just plain HTML, I don't care about the Jekyll themes.
- Lastly, I had to publish the user site:
  - Navigate to `Settings` → `Pages` for this repository:
  - Under `Build and deployment` → `Source`, make sure that `Deploy from a branch` is selected.
  - Under `Build and deployment` → `Branch`, pick the branch and path. I chose `main` and `/ (root)`, which gives me the opportunity to create and merge pull requests as usual (as opposed to building the website from a branch).
  - I opted out of using a `Custom domain`, as it is not necessary.
  - Make sure that `Enforce HTTPS` is selected (I don't think it can be modified)

Once this is all set, wait a few minutes and then navigate to the website as indicated on the top of the `Settings` → `Pages` in GitHub (refresh to see it).
My user site can be accessed here: [https://katjes733.github.io/](https://katjes733.github.io/).
I also verified that I was able to download the public PEM file using the full URL in the browser: `https://katjes733.github.io/.well-known/appspecific/com.tesla.3p.public-key.pem`

When satisfied with the page and its content, you can move to the next step.

### Application Registration

1. Navigate to [https://developer.tesla.com/](https://developer.tesla.com/).
2. You will need to sign in to your existing Tesla account or create a new Tesla account. For either option, it is necessary to a=enable MFA, so follow the instructions to set everything up.
3. On the main [dashboard](https://developer.tesla.com/en_US/dashboard), click `Create New Application`.
4. Provide the following on the `Application Details` page:
   1. `Application Name`: should be unique and not presently used.
   2. `Application Description`: Should describe your application; I used a summarized text from my project site.
   3. `Purpose Of Usage`: I wasn't quite clear on what to provide here, so I used a more verbose version of the Application Description for that field.
   4. Once completed, click `Next`
5. Provide the following on the `Client Details` page:
   1. `OAuth Grant Type`: select `Authorization Code and Machine-to-Machine`
   2. `Allowed Origin URL(s)`: `https://katjes733.github.io` (here we only need the top level domain)
   3. `Allowed Redirect URL(s)`: `https://katjes733.github.io/tesla-powerwall-automation/` (basically my repo) and `http://localhost:3001/callback` (which will be used for the implementation that retrieves the so called `Refresh Token`; more on that later or [here](http://localhost:3001/callback))
   4. `Allowed Returned URL(s) (Optional)`: `https://katjes733.github.io/tesla-powerwall-automation/` (probably never used for me)
   5. Once completed, click `Next`.
      **NOTE:** most of these URLs are only relevant when you have users interacting with you application, which is not the use case here (machine-to-machine)
6. Provide the following on the `API & Scopes` page:
   1. Select `Profile Information`, `Energy Product Information` and `Energy product Commands`.
   2. Once completed, click `Submit`.
      **NOTE:** These settings are for the use case of wanting to control the Powerwall. If you want to interact with your Tesla vechicle you will have to expand the scope to the relevant scopes.
7. My request for the application was immediately approved, but it may be possible that there is a manual approval by Tesla. So, be patient and provide any information as necessary.
8. You are now able to see your application in your account. You will need the Client ID and the Client Secret for later.

### Region registration

You will need to register your application for the corresponding API endpoints in the correponding region. In my case I am going to register the application in North America. Other regions are Europe and ...

#### Retrieve client credentials

The first step is to use the global auth API to retrieve a client credential token for the next step of actually registering the applicaiton in the desired region.

**NOTE:** I usually use PostMan for interacting with public APIs, but for some reason I could not get this to work with Postman, so I fell back to curl.

1. Set the client credentials:

```sh
export CLIENT_ID='<client_id>'
export CLIENT_SECRET='<client_secret'
```

**NOTE:** Replace with the corresponding client credentials and maintain the single quotes.

2. Set the desired API endpoint:

```sh
export AUDIENCE="https://fleet-api.prd.na.vn.cloud.tesla.com"
```

**NOTE:** This is the North America API endpoint.

3. Run the following:

```sh
curl --request POST \
--header 'Content-Type: application/x-www-form-urlencoded' \
--data-urlencode 'grant_type=client_credentials' \
--data-urlencode "client_id=$CLIENT_ID" \
--data-urlencode "client_secret=$CLIENT_SECRET" \
--data-urlencode 'scope=openid offline_access user_data energy_device_data energy_cmds' \
--data-urlencode "audience=$AUDIENCE" \
'https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token'
```

**NOTE:** The scope here is limited to interacting with Powerwall. For vehicle access you need to adjust the scope accordingly.

4. Assuming the client credentials were valid, the response will contain the client credential token in field `access_token`. Retain it, but keep in mind that it is valid only for 8 hours.

#### Register the region

To register the region, I used Postman with the following request settings:

1. Method: `POST`
2. URL: `https://fleet-api.prd.na.vn.cloud.tesla.com/api/1/partner_accounts` (North America Endpoint)
3. Authorization: `Bearer Token` with the client credential token generated in the previous [step](#retrieve-client-credentials).
4. Header: `Content-Type`: `application/json`
5. Body: `raw`:

   ```json
   {
     "domain": "katjes733.github.io"
   }
   ```

   **NOTE:** replace with your top level domain, which should correspond to the [user site](#user-site). This API call will actually need to access the file `.well-known/appspecific/com.tesla.3p.public-key.pem`. Therefore, make sure your User Site or other web hosting is configured correctly as outlined in [User Site](#user-site).

6. Send the Request. You should get a positive response back indicating that your application has been registered with the corresponding region.

Only now with these steps completed you are able to interact with the regional API endpoint.

## Tesla Fleet API authentication
