FROM nginx:1.27-alpine

# Remove default config supplied by the base image
RUN rm /etc/nginx/conf.d/default.conf

# Copy our custom configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Expose HTTP port
EXPOSE 80

# nginx runs in foreground by default in the official image
CMD ["nginx", "-g", "daemon off;"]
