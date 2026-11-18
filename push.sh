#!/usr/bin/env bash
# Quick push script for Anicore
set -e

cd "$(dirname "$0")"

echo "Adding changes..."
git add .

MESSAGE="${1:-Update Anicore code}"
echo "Committing with message: '$MESSAGE'"
git commit -m "$MESSAGE" || echo "No changes to commit."

echo "Pushing to GitHub..."
git push origin main

echo "Successfully pushed to GitHub!"
