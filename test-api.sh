#!/bin/bash

# API Base URL
BASE_URL="http://localhost:3000"

echo "=== Testing Claude Agent SDK API ==="
echo ""

# 1. Health Check
echo "1. Health Check:"
echo "curl -X GET $BASE_URL/api/health"
curl -X GET "$BASE_URL/api/health"
echo -e "\n"

# 2. Start a new query
echo "2. Starting a new agent process:"
echo "curl -X POST $BASE_URL/api/query -H 'Content-Type: application/json' -d '{\"prompt\": \"Hello, Claude! Can you help me test the API?\"}'"
RESPONSE=$(curl -s -X POST "$BASE_URL/api/query" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Hello, Claude! Can you help me test the API?"}')

echo "$RESPONSE"
echo ""

# Extract process ID from response
PROCESS_ID=$(echo "$RESPONSE" | grep -o '"processId":"[^"]*' | cut -d'"' -f4)

if [ -z "$PROCESS_ID" ]; then
  echo "Failed to get process ID. Response was:"
  echo "$RESPONSE"
  exit 1
fi

echo "Process ID: $PROCESS_ID"
echo ""

# 3. Check status (wait a bit first)
echo "3. Waiting 2 seconds before checking status..."
sleep 2

echo "curl -X GET $BASE_URL/api/status/$PROCESS_ID"
curl -X GET "$BASE_URL/api/status/$PROCESS_ID"
echo -e "\n"

# 4. List all processes
echo "4. Listing all processes:"
echo "curl -X GET $BASE_URL/api/processes"
curl -X GET "$BASE_URL/api/processes"
echo -e "\n"

# 5. Root endpoint
echo "5. Root endpoint (API info):"
echo "curl -X GET $BASE_URL/"
curl -X GET "$BASE_URL/"
echo -e "\n"

echo "=== Test Complete ==="
echo ""
echo "To check the status again, run:"
echo "curl -X GET $BASE_URL/api/status/$PROCESS_ID"
echo ""
echo "To cancel the process, run:"
echo "curl -X POST $BASE_URL/api/status/$PROCESS_ID/cancel"

