all: ci

# run all tests under test/
check: run
	ink ./src/tests.ink
t: check

fmt:
	inkfmt fix lib/*.ink *.ink
f: fmt

fmt-check:
	inkfmt lib/*.ink *.ink
fk: fmt-check

