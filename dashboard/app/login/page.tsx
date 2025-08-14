"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shield, Loader2, AlertCircle } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [licenseKey, setLicenseKey] = useState("");
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      // Validate inputs
      if (!licenseKey || !domain) {
        setError("Please enter both license key and domain");
        setLoading(false);
        return;
      }

      // Clean domain (remove protocol if present)
      const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");

      // Use auth context login
      const success = await login(licenseKey.trim(), cleanDomain);
      
      if (success) {
        // Redirect to dashboard
        router.push("/");
      } else {
        setError("Invalid license key or domain");
      }
    } catch (err) {
      setError("Failed to connect to server. Please try again.");
      console.error("Login error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        {/* Logo/Title */}
        <div className="text-center">
          <div className="mx-auto w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">Sales Agent</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Enter your license key to access the dashboard
          </p>
        </div>

        {/* Login Form */}
        <Card>
          <CardHeader>
            <CardTitle>Sign In</CardTitle>
            <CardDescription>
              Use the same credentials as your main dashboard
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label htmlFor="licenseKey" className="text-sm font-medium mb-2 block">
                  License Key
                </label>
                <input
                  id="licenseKey"
                  type="text"
                  className="w-full px-3 py-2 bg-background border rounded-md text-sm"
                  placeholder="Enter your license key"
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value)}
                  disabled={loading}
                  autoFocus
                />
              </div>

              <div>
                <label htmlFor="domain" className="text-sm font-medium mb-2 block">
                  Domain
                </label>
                <input
                  id="domain"
                  type="text"
                  className="w-full px-3 py-2 bg-background border rounded-md text-sm"
                  placeholder="yourdomain.com"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  disabled={loading}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  The domain associated with your license
                </p>
              </div>

              {error && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  {error}
                </div>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  "Sign In"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center text-sm text-muted-foreground">
          <p>
            Don't have a license?{" "}
            <a 
              href="https://yoursite.com/purchase" 
              className="text-primary hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Get one here
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}