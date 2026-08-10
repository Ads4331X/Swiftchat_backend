#!/bin/bash
# Comprehensive API test script for the chat backend (idempotent)
BASE="http://localhost:3000"
PASS=0
FAIL=0
RUN_SUFFIX=$RANDOM
U1="user_${RUN_SUFFIX}1"
U2="user_${RUN_SUFFIX}2"
U1_EMAIL="${U1}@test.com"
U2_EMAIL="${U2}@test.com"

req() {
  local method=$1 path=$2 body=$3 token=$4
  local auth=""
  if [ -n "$token" ]; then auth="-H \"Authorization: Bearer $token\""; fi
  if [ -n "$body" ]; then
    eval curl -s -X "$method" "$BASE$path" -H '"Content-Type: application/json"' "$auth" -d "'$body'"
  else
    eval curl -s -X "$method" "$BASE$path" "$auth"
  fi
}

check() {
  local name=$1 expected=$2 actual=$3
  if [[ "$actual" == *"$expected"* ]]; then
    echo "PASS: $name"
    PASS=$((PASS+1))
  else
    echo "FAIL: $name (expected '$expected', got '$actual')"
    FAIL=$((FAIL+1))
  fi
}

echo "=== REGISTRATION TESTS ==="
OUT=$(req POST /api/auth/register "{\"username\":\"$U1\",\"email\":\"$U1_EMAIL\",\"password\":\"Password1!\",\"confirmPassword\":\"Password1!\"}")
check "valid registration" "Account created successfully" "$OUT"

OUT=$(req POST /api/auth/register "{\"username\":\"${U1}x\",\"email\":\"$U1_EMAIL\",\"password\":\"Password1!\",\"confirmPassword\":\"Password1!\"}")
check "duplicate email" "Email already registered" "$OUT"

OUT=$(req POST /api/auth/register "{\"username\":\"$U1\",\"email\":\"${U1}x@test.com\",\"password\":\"Password1!\",\"confirmPassword\":\"Password1!\"}")
check "duplicate username" "Username already taken" "$OUT"

OUT=$(req POST /api/auth/register "{\"username\":\"${U1}2\",\"email\":\"notanemail\",\"password\":\"Password1!\",\"confirmPassword\":\"Password1!\"}")
check "invalid email" "Invalid email address" "$OUT"

OUT=$(req POST /api/auth/register "{\"username\":\"${U1}3\",\"email\":\"${U1}3@test.com\",\"password\":\"weak\",\"confirmPassword\":\"weak\"}")
check "weak password" "Password must be at least 8 characters" "$OUT"

OUT=$(req POST /api/auth/register '{"username":"","email":"","password":"","confirmPassword":""}')
check "missing fields" "Username is required" "$OUT"

echo "=== LOGIN TESTS ==="
OUT=$(req POST /api/auth/login "{\"email\":\"$U1_EMAIL\",\"password\":\"Password1!\"}")
check "correct credentials (has token)" '"token"' "$OUT"
TOKEN=$(echo "$OUT" | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))")

OUT=$(req POST /api/auth/login "{\"email\":\"$U1_EMAIL\",\"password\":\"WrongPass1!\"}")
check "wrong password" "Invalid email or password" "$OUT"

OUT=$(req POST /api/auth/login "{\"email\":\"nobody@test.com\",\"password\":\"Password1!\"}")
check "nonexistent user" "Invalid email or password" "$OUT"

OUT=$(req POST /api/auth/login '{"email":"","password":""}')
check "login missing fields" "Email and password are required" "$OUT"

echo "=== AUTH MIDDLEWARE TESTS ==="
OUT=$(req GET /api/user/user-details)
check "no token -> 401" "Unauthorized" "$OUT"

OUT=$(req GET /api/user/user-details "" "invalidtoken123")
check "invalid token" "Invalid token" "$OUT"

OUT=$(req GET /api/user/user-details "" "$TOKEN")
check "valid token -> user details" "$U1" "$OUT"

echo "=== /ME (user-details) TESTS ==="
OUT=$(req GET /api/user/user-details "" "$TOKEN")
check "/me returns username" "$U1" "$OUT"
if [[ "$OUT" == *"password_hash"* ]] || [[ "$OUT" == *"password"* ]]; then
  echo "FAIL: /me leaks password_hash: $OUT"
  FAIL=$((FAIL+1))
else
  echo "PASS: /me does not leak password_hash"
  PASS=$((PASS+1))
fi

echo "=== CHANGE PASSWORD TESTS ==="
OUT=$(req PATCH /api/user/change-password "{\"currentPassword\":\"WrongPass1!\",\"newPassword\":\"NewPassword1!\",\"confirmNewPassword\":\"NewPassword1!\"}" "$TOKEN")
check "change pw wrong current" "Current password is incorrect" "$OUT"

OUT=$(req PATCH /api/user/change-password "{\"currentPassword\":\"Password1!\",\"newPassword\":\"weak\",\"confirmNewPassword\":\"weak\"}" "$TOKEN")
check "change pw weak new" "Password must be at least 8 characters" "$OUT"

OUT=$(req PATCH /api/user/change-password "{\"currentPassword\":\"Password1!\",\"newPassword\":\"NewPassword1!\",\"confirmNewPassword\":\"Different1!\"}" "$TOKEN")
check "change pw mismatch" "Passwords do not match" "$OUT"

OUT=$(req PATCH /api/user/change-password "{\"newPassword\":\"NewPassword1!\",\"confirmNewPassword\":\"NewPassword1!\"}" "$TOKEN")
check "change pw missing current" "Current password is required" "$OUT"

OUT=$(req PATCH /api/user/change-password "{\"currentPassword\":\"Password1!\",\"newPassword\":\"NewPassword1!\",\"confirmNewPassword\":\"NewPassword1!\"}" "$TOKEN")
check "change pw valid" "Password changed successfully" "$OUT"

OUT=$(req POST /api/auth/login "{\"email\":\"$U1_EMAIL\",\"password\":\"Password1!\"}")
check "old password no longer works" "Invalid email or password" "$OUT"

OUT=$(req POST /api/auth/login "{\"email\":\"$U1_EMAIL\",\"password\":\"NewPassword1!\"}")
check "new password works" '"token"' "$OUT"
TOKEN=$(echo "$OUT" | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))")

echo "=== USER SEARCH TESTS ==="
req POST /api/auth/register "{\"username\":\"$U2\",\"email\":\"$U2_EMAIL\",\"password\":\"Password1!\",\"confirmPassword\":\"Password1!\"}" > /dev/null
OUT=$(req GET "/api/user/search?username=$U2" "" "$TOKEN")
check "search exact" "$U2" "$OUT"
OUT=$(req GET "/api/user/search?username=$U1" "" "$TOKEN")
check "search partial" "$U1" "$OUT"
OUT=$(req GET "/api/user/search?username=$(echo $U2 | tr '[:lower:]' '[:upper:]')" "" "$TOKEN")
check "search uppercase" "$U2" "$OUT"
OUT=$(req GET "/api/user/search?username=zzz_nobody" "" "$TOKEN")
check "search nonexistent" '"users":[]' "$OUT"
OUT=$(req GET "/api/user/search?username=" "" "$TOKEN")
check "search empty" "Username is required" "$OUT"
OUT=$(req GET "/api/user/search?username=$U1" "" "$TOKEN")
if [[ "$OUT" == *"password"* ]]; then
  echo "FAIL: search leaks password: $OUT"
  FAIL=$((FAIL+1))
else
  echo "PASS: search does not leak password"
  PASS=$((PASS+1))
fi

echo "=== CONVERSATION TESTS ==="
OUT=$(req POST /api/conversations/new-conversation "{\"targetUsername\":\"$U2\"}" "$TOKEN")
check "create conversation" "New conversation created" "$OUT"
OUT=$(req POST /api/conversations/new-conversation "{\"targetUsername\":\"$U2\"}" "$TOKEN")
check "duplicate conversation" "already exists" "$OUT"
OUT=$(req POST /api/conversations/new-conversation "{\"targetUsername\":\"$U1\"}" "$TOKEN")
check "conversation with self" "yourself" "$OUT"
OUT=$(req POST /api/conversations/new-conversation "{\"targetUsername\":\"zzz_nobody\"}" "$TOKEN")
check "nonexistent target" "not found" "$OUT"
OUT=$(req POST /api/conversations/new-conversation "{\"targetUsername\":\"$U2\"}")
check "unauthenticated create" "Unauthorized" "$OUT"
OUT=$(req GET /api/conversations "" "$TOKEN")
check "get conversations" "$U2" "$OUT"
OUT=$(req GET /api/conversations)
check "get conversations unauth" "Unauthorized" "$OUT"

# Test that a user only sees their own conversations
OUT=$(req POST /api/auth/login "{\"email\":\"$U2_EMAIL\",\"password\":\"Password1!\"}")
TOKEN2=$(echo "$OUT" | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))")
OUT=$(req GET /api/conversations "" "$TOKEN2")
check "user2 sees conversation" "$U1" "$OUT"

echo ""
echo "=== RESULTS ==="
echo "PASS: $PASS"
echo "FAIL: $FAIL"
