all: run

run:
	ls *.ink **/*.ink | entr -cr ink main.ink

fmt:
	inkfmt fix lib/*.ink *.ink
f: fmt

fmt-check:
	inkfmt lib/*.ink *.ink
fk: fmt-check

