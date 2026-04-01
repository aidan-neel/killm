package main

import (
	_ "embed"
	"fmt"
	"net"
	"os"
	"os/exec"
	"syscall"

	"github.com/getlantern/systray"
)

//go:embed icon.ico
var iconData []byte
var targets []string

func runHidden(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow: true,
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		fmt.Printf("err=%v out=%s\n", err, out)
	}
	return err
}

func isAdmin() bool {
	_, err := os.Open(`\\.\PHYSICALDRIVE0`)
	return err == nil
}

func relaunchAsAdmin() {
	exe, _ := os.Executable()
	cmd := exec.Command("powershell", "-Command", "Start-Process", exe, "-Verb", "runAs")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	cmd.Start()
	os.Exit(0)
}

func ensureAdmin() {
	if !isAdmin() {
		relaunchAsAdmin()
	}
}

func main() {
	ensureAdmin()

	targets = []string{
		// OpenAI
		"api.openai.com",
		"chat.openai.com",
		"chatgpt.com",
		"platform.openai.com",
		"openai.com",

		// Anthropic / Claude
		"api.anthropic.com",
		"claude.ai",
		"anthropic.com",

		// Google / Gemini
		"generativelanguage.googleapis.com",
		"ai.google.dev",
		"gemini.google.com",

		// xAI / Grok
		"api.x.ai",
		"x.ai",
		"grok.x.ai",

		// Mistral
		"api.mistral.ai",
		"mistral.ai",
		"console.mistral.ai",

		// Cohere
		"api.cohere.com",
		"cohere.com",

		// Together
		"api.together.xyz",
		"together.ai",

		// Groq
		"api.groq.com",
		"groq.com",

		// Fireworks
		"api.fireworks.ai",
		"fireworks.ai",

		// SambaNova
		"api.sambanova.ai",
		"sambanova.ai",

		// Replicate
		"api.replicate.com",
		"replicate.com",

		// Hugging Face
		"huggingface.co",

		// Perplexity
		"api.perplexity.ai",
		"perplexity.ai",

		// DeepSeek
		"api.deepseek.com",
		"deepseek.com",

		// Poe
		"poe.com",

		// Character AI
		"character.ai",

		// Phind
		"phind.com",
	}

	systray.Run(onReady, onExit)
}

func blockIPs() {
	for _, host := range targets {
		ips, err := net.LookupIP(host)
		if err != nil {
			fmt.Println("lookup failed:", host, err)
			continue
		}

		for _, ip := range ips {
			runHidden("netsh", "advfirewall", "firewall", "add", "rule",
				"name=killm-"+ip.String(),
				"dir=out",
				"action=block",
				"remoteip="+ip.String(),
			)
		}
	}

}

func unblockIPs() {
	for _, host := range targets {
		ips, err := net.LookupIP(host)
		if err != nil {
			fmt.Println("lookup failed:", host, err)
			continue
		}

		for _, ip := range ips {
			runHidden("netsh", "advfirewall", "firewall", "delete", "rule",
				"name=killm-"+ip.String(),
			)
		}
	}
}

func mQuit() {
	mQuit := systray.AddMenuItem("Quit", "Quit the whole app")
	mQuit.SetTooltip("Quit application")

	go func() {
		for range mQuit.ClickedCh {
			systray.Quit()
		}
	}()
}

func cDisableAll() {
	cDisable := systray.AddMenuItemCheckbox("Disable All", "Disable all LLM access", false)
	cDisable.SetTooltip("Disables all LLM access")

	go func() {
		for range cDisable.ClickedCh {
			if cDisable.Checked() {
				cDisable.Uncheck()
				unblockIPs()
			} else {
				cDisable.Check()
				blockIPs()
			}
		}
	}()
}

func onReady() {
	systray.SetIcon(iconData)
	systray.SetTitle("killm")
	systray.SetTooltip("Kill LLMs")

	mQuit()
	cDisableAll()
}

func onExit() {
	unblockIPs()
}
