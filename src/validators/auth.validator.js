import validator from "validator";

function validateRegister({ username, email, password, confirmPassword }) {
  const cleanUsername = username?.trim();
  const cleanEmail = email?.trim().toLowerCase();

  if (!cleanUsername || !cleanEmail || !password || !confirmPassword) {
    return { error: "All fields are required" };
  }

  if (cleanUsername.length < 3) {
    return { error: "Username must be at least 3 characters" };
  }

  if (!validator.isEmail(cleanEmail)) {
    return { error: "Invalid email address" };
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

  if (password !== confirmPassword) {
    return { error: "Passwords do not match" };
  }

  return {
    data: {
      username: cleanUsername,
      email: cleanEmail,
      password,
    },
  };
}

export default validateRegister;
