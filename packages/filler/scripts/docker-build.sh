#!/bin/bash
set -e

# Script to build the Hyperbridge Filler Docker image

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default values
IMAGE_NAME="hyperbridge/filler"
IMAGE_TAG="latest"
DOCKERFILE="Dockerfile"
BUILD_CONTEXT="."

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -n|--name)
            IMAGE_NAME="$2"
            shift 2
            ;;
        -t|--tag)
            IMAGE_TAG="$2"
            shift 2
            ;;
        -f|--file)
            DOCKERFILE="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [options]"
            echo "Options:"
            echo "  -n, --name <name>     Docker image name (default: hyperbridge/filler)"
            echo "  -t, --tag <tag>       Docker image tag (default: latest)"
            echo "  -f, --file <file>     Dockerfile path (default: Dockerfile)"
            echo "  -h, --help            Show this help message"
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

# Check if Dockerfile exists
if [ ! -f "$DOCKERFILE" ]; then
    echo -e "${RED}Error: Dockerfile not found at $DOCKERFILE${NC}"
    exit 1
fi

echo -e "${YELLOW}Building Docker image...${NC}"
echo "Image: ${IMAGE_NAME}:${IMAGE_TAG}"
echo "Dockerfile: ${DOCKERFILE}"
echo "Context: ${BUILD_CONTEXT}"

# Build the Docker image
if docker build -t "${IMAGE_NAME}:${IMAGE_TAG}" -f "${DOCKERFILE}" "${BUILD_CONTEXT}"; then
    echo -e "${GREEN}✓ Docker image built successfully!${NC}"
    echo -e "${GREEN}Image: ${IMAGE_NAME}:${IMAGE_TAG}${NC}"

    # Show image size
    IMAGE_SIZE=$(docker images "${IMAGE_NAME}:${IMAGE_TAG}" --format "{{.Size}}")
    echo -e "${GREEN}Size: ${IMAGE_SIZE}${NC}"
else
    echo -e "${RED}✗ Docker build failed${NC}"
    exit 1
fi

# Tag as latest if not already latest
if [ "${IMAGE_TAG}" != "latest" ]; then
    docker tag "${IMAGE_NAME}:${IMAGE_TAG}" "${IMAGE_NAME}:latest"
    echo -e "${GREEN}✓ Also tagged as ${IMAGE_NAME}:latest${NC}"
fi

echo -e "${YELLOW}To run the container:${NC}"
echo "  docker run -v ./filler-config.toml:/app/config/filler-config.toml ${IMAGE_NAME}:${IMAGE_TAG}"
