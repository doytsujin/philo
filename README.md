# philo - stack-test.rb
Implemented using node.js

### Installation Instructions
1. Install dependencies witn `npm install`
2. Customize your config.json

3. Make sure directory for logDirctory exists, e.g. `$prompt> mkdir logs/`

### Execution Instructions
1. Configure your `$NODE_ENV` for the right logging level: 
  - `$ export NODE_ENV=debugging`
  - default is development, see below for options

2. Execute the code, e.g. prompt> node server.js

3. Kill gracefully w/ `CTRL+c` or `kill`

### Environment configuration
See [winston documentation](https://github.com/winstonjs/winston) for description of log levels
 
 - *production*  :== Only log errors, no console
 - *testing*     :== Log up to info, no console
 - *development* :== Log up to verbose, with console
 - *debugging*   :== Log silly, with console

### Diagnostic instructions
1. The diagnostic port is configured in config.json
2. I like running it with `$telnet <ipAddr> <port>`

### Tested as follows:
* `$ node --version` `v10.13.0`
* `$ sw_vers`
```
      ProductName:         Mac OS X
      ProductVersion:      10.14
      BuildVersion:        18A391
```
* `$ruby --version` `2.3.7p456 (2018-03-28 revision 63024) [universal.x86_64-darwin18]`
