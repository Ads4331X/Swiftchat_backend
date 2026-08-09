import validator from "validator";

export function validateUsername(username) {
  const cleanUsername = username?.trim();

  if (!cleanUsername) {
    return { error: "Username is required" };
  }

  if (cleanUsername.length < 3) {
    return { error: "Username must be at least 3 characters" };
  }

  return { data: cleanUsername };
}

export function validateEmail(email) {
  const cleanEmail = email?.trim().toLowerCase();

  if (!cleanEmail) {
    return { error: "Email is required" };
  }

  if (!validator.isEmail(cleanEmail)) {
    return { error: "Invalid email address" };
  }

  return { data: cleanEmail };
}

export function validatePassword(password) {
  if (!password) {
    return { error: "Password is required" };
  }

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters" };
  }

  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);

  if (!hasUppercase || !hasLowercase || !hasNumber || !hasSpecial) {
    return {
      error:
        "Password must contain uppercase, lowercase, number and special character",
    };
  }

  return { data: password };
}

export function validatePasswordMatch(password, confirmPassword) {
  if (!confirmPassword) {
    return { error: "Please confirm your password" };
  }

  if (password !== confirmPassword) {
    return { error: "Passwords do not match" };
  }

  return { data: true };
}

export default function validateRegister({
  username,
  email,
  password,
  confirmPassword,
}) {
  const usernameResult = validateUsername(username);
  if (usernameResult.error) return usernameResult;

  const emailResult = validateEmail(email);
  if (emailResult.error) return emailResult;

  const passwordResult = validatePassword(password);
  if (passwordResult.error) return passwordResult;

  const matchResult = validatePasswordMatch(password, confirmPassword);
  if (matchResult.error) return matchResult;

  return {
    data: {
      username: usernameResult.data,
      email: emailResult.data,
      password: passwordResult.data,
    },
  };
}
