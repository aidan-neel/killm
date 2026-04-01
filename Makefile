build:
	cd src && CC=x86_64-w64-mingw32-gcc GOOS=windows GOARCH=amd64 CGO_ENABLED=1 go build -ldflags="-H=windowsgui" -o ../dist/killm.exe

dev:
	cd src && go run main.go
