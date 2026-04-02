SOURCE?=
LIMIT?=250
MODE?=latest
REQUIRE_MEDIA?=0
REQUIRE_LOCAL_MEDIA?=0

refresh-viewer-data:
	python3 build_viewer_data.py $(SOURCE)

test-viewer:
	python3 -m unittest discover -s tests -t . -p 'test_*.py'

import-viewer-subset:
	@test -n "$(SOURCE)" || (echo "Set SOURCE=/path/to/archive or SOURCE=/path/to/raw_data" && exit 1)
	python3 import_archive_subset.py "$(SOURCE)" --limit $(LIMIT) --strategy $(MODE) $(if $(filter 1,$(REQUIRE_MEDIA)),--require-media,) $(if $(filter 1,$(REQUIRE_LOCAL_MEDIA)),--require-local-media,)

launch-archive-viewer: refresh-viewer-data
	npx http-server -o index.html
