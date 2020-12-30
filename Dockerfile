FROM alpine:3.12
RUN apk add --no-cache bash

# Add Ink interpreter
ADD https://github.com/thesephist/ink/releases/download/v0.1.8/ink-linux /usr/local/bin/ink
RUN chmod +x /usr/local/bin/ink

WORKDIR /app
ADD . /app

SHELL ["/bin/bash", "-c"]

RUN echo $'\n\
if [ ! -f "credentials.ink" ]; then\n\
  echo "UserID := \'$USER_ID\'\n\
ConsumerKey := \'$CONSUMER_KEY\'\n\
ConsumerSecret := \'$CONSUMER_SECRET\'\n\
BearerToken := \'$BEARER_TOKEN\'\n\
OAuthToken := \'$OAUTH_TOKEN\'\n\
OAuthSecret := \'$OAUTH_SECRET\'" > credentials.ink \n\
fi \n\
if [[ ! -z "$USER_NAME" ]]; then \n\
  sed -i "s/const ME = .*/const ME = \'$USER_NAME\'/g" static/js/main.js \n\
fi \n\
exec ink main.ink' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

EXPOSE 7238
ENTRYPOINT /app/entrypoint.sh
