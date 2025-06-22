# tesla-powerwall-automation

- [tesla-powerwall-automation](#tesla-powerwall-automation)
  - [Tesla Fleet API onboarding](#tesla-fleet-api-onboarding)
    - [Preparation](#preparation)
      - [Project Site](#project-site)
      - [User Site](#user-site)
    - [Application Registration](#application-registration)
    - [Region registration](#region-registration)
      - [Retrieve client credentials](#retrieve-client-credentials)
      - [Register the region](#register-the-region)
  - [Tesla Fleet API authentication](#tesla-fleet-api-authentication)

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
