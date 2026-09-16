export type Register = {
  username: string;
  password: string;
  confirmPassword: string;
  email: string;
};

export type Login = {
  email: string;
  password: string;
};

export type ForgotPassword = { email: string };
export type VerifyOTP = { email: string; otp: string };
export type ResetPassword = {
  otp: string;
  newPassword: string;
  confirmNewPassword: string;
  email: string;
};

export type UserDetails = {
  username: string;
  email: string;
  userId: number;
};

export type updateKeyBackUp = {
  userId: number;
  encryptedPrivateKey: string;
  nonce: string;
  salt: string;
  opsLimit: string;
  memLimit: string;
  alg: string;
};
