#!/bin/bash
DEPLOY_DIR=/opt/app/$1       # BUG: unquoted variable
rm -rf $DEPLOY_DIR/*         # BUG: dangerous rm -rf with unquoted var
cp -r build/* $DEPLOY_DIR
cd $DEPLOY_DIR               # BUG: no error check on cd
./restart.sh
