#!/bin/bash
set -e

# Script to run the Hyperbridge Filler Docker container

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default values
IMAGE_NAME="hyperbridge/filler"
IMAGE_TAG="latest"
CONFIG_FILE="filler-config.toml"
CONTAINER_NAME="hyperbridge-filler"
RESTART_POLICY="unless-stopped"
DETACH=true

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -n|--name)
            CONTAINER_NAME="$2"
            shift 2
            ;;
        -i|--image)
            IMAGE_NAME="$2"
            shift 2
            ;;
        -t|--tag)
            IMAGE_TAG="$2"
            shift 2
            ;;
        -c|--config)
            CONFIG_FILE="$2"
            shift 2
            ;;
        -f|--foreground)
            DETACH=false
            shift
            ;;
        -r|--restart)
            RESTART_POLICY="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [options]"
            echo "Options:"
            echo "  -n, --name <name>        Container name (default: hyperbridge-filler)"
            echo "  -i, --image <name>       Docker image name (default: hyperbridge/filler)"
            echo "  -t, --tag <tag>          Docker image tag (default: latest)"
            echo "  -c, --config <file>      Config file path (default: filler-config.toml)"
            echo "  -f, --foreground         Run in foreground (default: background)"
            echo "  -r, --restart <policy>   Restart policy (default: unless-stopped)"
            echo "  -h, --help               Show this help message"
            exit 0
            ;;
        *)
            echo -e "${RED}Error: Unknown option $1${NC}"
            exit 1
            ;;
    esac
done

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed${NC}"
    exit 1
fi

# Check if config file exists
if [ ! -f "$CONFIG_FILE" ]; then
    echo -e "${RED}Error: Config file not found at $CONFIG_FILE${NC}"
    echo -e "${YELLOW}Generate a config file with: filler init -o $CONFIG_FILE${NC}"
    exit 1
fi

# Check if image exists
if ! docker image inspect "${IMAGE_NAME}:${IMAGE_TAG}" &> /dev/null; then
    echo -e "${RED}Error: Docker image ${IMAGE_NAME}:${IMAGE_TAG} not found${NC}"
    echo -e "${YELLOW}Build it first with: ./scripts/docker-build.sh${NC}"
    exit 1
fi

# Check if container is already running
if docker ps -q -f name="^${CONTAINER_NAME}$" | grep -q .; then
    echo -e "${YELLOW}Container ${CONTAINER_NAME} is already running${NC}"
    read -p "Stop and restart? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Stopping existing container..."
        docker stop "${CONTAINER_NAME}"
        docker rm "${CONTAINER_NAME}"
    else
        exit 0
    fi
fi

# Prepare run command
RUN_CMD="docker run"

if [ "$DETACH" = true ]; then
    RUN_CMD="$RUN_CMD -d"
fi

RUN_CMD="$RUN_CMD --name ${CONTAINER_NAME}"
RUN_CMD="$RUN_CMD --restart ${RESTART_POLICY}"
RUN_CMD="$RUN_CMD -v $(pwd)/${CONFIG_FILE}:/app/config/filler-config.toml:ro"
RUN_CMD="$RUN_CMD -e NODE_ENV=production"

# Add logging
RUN_CMD="$RUN_CMD --log-driver json-file"
RUN_CMD="$RUN_CMD --log-opt max-size=10m"
RUN_CMD="$RUN_CMD --log-opt max-file=3"

# Image name
RUN_CMD="$RUN_CMD ${IMAGE_NAME}:${IMAGE_TAG}"

echo -e "${YELLOW}Starting Hyperbridge Filler...${NC}"
echo "Container: ${CONTAINER_NAME}"
echo "Image: ${IMAGE_NAME}:${IMAGE_TAG}"
echo "Config: ${CONFIG_FILE}"

# Run the container
if eval $RUN_CMD; then
    if [ "$DETACH" = true ]; then
        echo -e "${GREEN}✓ Container started successfully!${NC}"
        echo
        echo -e "${YELLOW}Useful commands:${NC}"
        echo "  View logs:   docker logs -f ${CONTAINER_NAME}"
        echo "  Stop:        docker stop ${CONTAINER_NAME}"
        echo "  Restart:     docker restart ${CONTAINER_NAME}"
        echo "  Status:      docker ps -f name=${CONTAINER_NAME}"
    else
        echo -e "${GREEN}✓ Container started in foreground mode${NC}"
    fi
else
    echo -e "${RED}✗ Failed to start container${NC}"
    exit 1
fi
