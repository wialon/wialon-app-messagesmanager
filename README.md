# Messages Manager, version 1.4.1: (November 24, 2026)
This is WEB application based on Apps from Gurtam (http://apps.wialon.com).

**This is a legacy app: it is no longer developed or maintained. The code is published as is, without support.**

## Description
Messages Manager is a useful application when it comes to working with unit database. All types of messages (data, SMS, command, event) can be retrieved from the database and displayed in a handy tabular view. You only choose a unit and time interval. The application also enables you to delete improper messages from the database.

## License
[The MIT License](LICENSE-MIT)

## Requirements
 * Browser: a current version of Google Chrome, Firefox, Safari or Edge
 * Language: en, br, es, fa, pl, ru
 * Components: SDK
 * URL params: Active SID, Base URL, Host URL, Language, Current user

## Quick start
Apps activation through the management system: https://help.wialon.com/en/wialon-hosting/user-guide/management-system/apps  
Working with applications in the GPS tracking system: https://help.wialon.com/en/wialon-hosting/user-guide/monitoring-system/apps

## Installation
The repository contains the app in the form it is hosted in. Put the files on a web server and open `index.html` with the URL params listed above, for example
`index.html?sid=<Active SID>&baseUrl=https://hst-api.wialon.com&user=<Current user>&lang=en`.

 * The time interval selector is loaded from `//apps.wialon.com/plugins/`.
