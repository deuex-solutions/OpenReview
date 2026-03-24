#!/bin/bash
USER_INPUT=$1
eval "echo Processing $USER_INPUT"                    # BUG: eval with user input
echo "DB_PASSWORD=supersecret123" > /etc/app/config   # BUG: hardcoded password
chmod 777 /etc/app/config                             # BUG: world-readable
curl -s "https://api.example.com/setup?name=$USER_INPUT" | bash  # BUG: pipe to bash
